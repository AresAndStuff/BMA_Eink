#include <Arduino.h>
#include <SPI.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <LittleFS.h>
#include <esp_sleep.h>
#include <GxEPD2_7C.h>

// Power / WiFi power save
#include "esp_wifi.h"

// =========================
// deep-sleep config
// =========================
static constexpr uint64_t SLEEP_MINUTES = 45;
static constexpr uint64_t uS_TO_S_FACTOR = 1000000ULL;
static constexpr uint64_t SLEEP_TIME_US = SLEEP_MINUTES * 60ULL * uS_TO_S_FACTOR;

// =========================
// Wi-Fi config
// =========================
const char* WIFI_SSID = "";
const char* WIFI_PASS = "";

// =========================
// Discovery config
// =========================
static const uint16_t DISCOVERY_PORT = 45454;
static const char* DISCOVERY_MSG = "DASHBOARD_DISCOVERY";
static const char* REPLY_PREFIX = "DASHBOARD_REPLY";
static const uint32_t DISCOVERY_TIMEOUT_MS = 2000;
static const int DISCOVERY_ATTEMPTS = 8;

// =========================
// HTTP path / local file
// =========================
static const char* HTTP_PATH = "/dashboard.bin";
static const char* LOCAL_BIN_PATH = "/dashboard.bin";

// ===== Your ESP32-C6 Pico wiring (so wie du es jetzt umverdrahtet hast) =====
// SPI:
static constexpr int PIN_SPI_MOSI = 18;  // DIN
static constexpr int PIN_SPI_SCK = 19;   // CLK
static constexpr int PIN_SPI_MISO = -1;  // not used

// Display control pins:
static constexpr int PIN_EPD_CS = 20;    // CS
static constexpr int PIN_EPD_DC = 3;     // DC
static constexpr int PIN_EPD_RST = 23;   // RST
static constexpr int PIN_EPD_BUSY = 22;  // BUSY

// ===== Display type: Waveshare 7.3" Spectra 6 =====
using Display = GxEPD2_7C<GxEPD2_730c_GDEP073E01, GxEPD2_730c_GDEP073E01::HEIGHT>;
Display display(GxEPD2_730c_GDEP073E01(PIN_EPD_CS, PIN_EPD_DC, PIN_EPD_RST, PIN_EPD_BUSY));

WiFiUDP udp;

// -------------------------
// BIN draw from LittleFS file
// Format: 800*480 bytes, row-major.
// Each byte is a palette index:
// 0=WHITE, 1=BLACK, 2=RED, 3=GREEN, 4=BLUE, 5=YELLOW
// -------------------------
bool drawBinFromFS(const char* path, int16_t x, int16_t y) {
  File f = LittleFS.open(path, "r");
  if (!f) {
    Serial.println("[BIN] open failed");
    return false;
  }

  const int W = display.width();
  const int H = display.height();

  const size_t expected = (size_t)W * (size_t)H;
  if ((size_t)f.size() < expected) {
    Serial.printf("[BIN] file too small: %u < %u\n",
                  (unsigned)f.size(), (unsigned)expected);
    f.close();
    return false;
  }

  static uint8_t row[800];  // width=800
  if (W > (int)sizeof(row)) {
    Serial.println("[BIN] width > row buffer");
    f.close();
    return false;
  }

  // ✅ FIX: korrektes Mapping gemäss Kommentar (0=WHITE, 1=BLACK, 2=RED, 3=GREEN, 4=BLUE, 5=YELLOW)
  static const uint16_t idxToColor[6] = {
    GxEPD_BLACK,   // 0  (#000000)
    GxEPD_WHITE,   // 1  (#FFFFFF)
    GxEPD_BLUE,    // 2  (#0000FF)
    GxEPD_GREEN,   // 3  (#00FF00)
    GxEPD_RED,     // 4  (#FF0000)
    GxEPD_YELLOW,  // 5  (#FFFF00)
  };

  for (int yy = 0; yy < H; yy++) {
    int n = f.read(row, W);
    if (n != W) {
      Serial.println("[BIN] short read");
      f.close();
      return false;
    }

    int16_t drawY = y + yy;
    if (drawY < 0 || drawY >= H) continue;

    for (int xx = 0; xx < W; xx++) {
      int16_t drawX = x + xx;
      if (drawX < 0 || drawX >= W) continue;

      uint8_t idx = row[xx];
      if (idx > 5) idx = 0;  // ✅ FIX: invalid -> WHITE (statt schwarz)
      display.drawPixel(drawX, drawY, idxToColor[idx]);
    }
  }

  f.close();
  return true;
}

// -------------------------
// UDP discovery: "DASHBOARD_REPLY <port>"
// -------------------------
bool parseReplyPort(const char* buf, int len, uint16_t& outPort) {
  if (!buf || len <= 0) return false;

  char tmp[128];
  int n = len;
  if (n >= (int)sizeof(tmp)) n = (int)sizeof(tmp) - 1;
  memcpy(tmp, buf, n);
  tmp[n] = '\0';

  size_t prefixLen = strlen(REPLY_PREFIX);
  if (strncmp(tmp, REPLY_PREFIX, prefixLen) != 0) return false;

  const char* p = tmp + prefixLen;
  while (*p == ' ' || *p == '\t') p++;

  long port = strtol(p, nullptr, 10);
  if (port <= 0 || port > 65535) return false;

  outPort = (uint16_t)port;
  return true;
}

bool discoverServer(IPAddress& serverIp, uint16_t& serverPort) {
  if (!udp.begin(0)) {
    Serial.println("[DISCOVERY] udp.begin() failed");
    return false;
  }

  Serial.printf("[DISCOVERY] Broadcast -> 255.255.255.255:%u\n", DISCOVERY_PORT);

  for (int attempt = 1; attempt <= DISCOVERY_ATTEMPTS; attempt++) {
    Serial.printf("[DISCOVERY] Attempt %d/%d\n", attempt, DISCOVERY_ATTEMPTS);

    udp.beginPacket(IPAddress(255, 255, 255, 255), DISCOVERY_PORT);
    udp.write((const uint8_t*)DISCOVERY_MSG, strlen(DISCOVERY_MSG));
    udp.endPacket();

    uint32_t start = millis();
    while (millis() - start < DISCOVERY_TIMEOUT_MS) {
      int packetSize = udp.parsePacket();
      if (packetSize <= 0) {
        delay(10);
        continue;
      }

      char buf[256];
      int n = udp.read(buf, (int)sizeof(buf));
      if (n <= 0) continue;

      uint16_t port = 0;
      if (!parseReplyPort(buf, n, port)) continue;

      serverIp = udp.remoteIP();
      serverPort = port;
      Serial.printf("[DISCOVERY] Found %s:%u\n", serverIp.toString().c_str(), serverPort);

      udp.stop();
      return true;
    }

    delay(300);
  }

  udp.stop();
  return false;
}

// -------------------------
// HTTP download to LittleFS
// -------------------------
bool downloadToLittleFS(const String& host, uint16_t port, const char* path, const char* dstPath) {
  WiFiClient client;
  client.setTimeout(15);

  Serial.printf("[HTTP] GET http://%s:%u%s\n", host.c_str(), port, path);

  if (!client.connect(host.c_str(), port)) {
    Serial.println("[HTTP] connect failed");
    return false;
  }

  client.print(String("GET ") + path + " HTTP/1.1\r\n" + "Host: " + host + "\r\n" + "Connection: close\r\n\r\n");

  // Warten bis etwas da ist (verhindert leere Statuszeile)
  uint32_t t0 = millis();
  while (!client.available() && client.connected() && (millis() - t0 < 3000)) {
    delay(5);
  }

  String status = client.readStringUntil('\n');
  status.trim();

  if (status.length() == 0) {
    Serial.println("[HTTP] empty status line (timeout/no data)");
    client.stop();
    return false;
  }

  Serial.printf("[HTTP] %s\n", status.c_str());

  // Akzeptiere auch 200 ohne exakte Prefix-Form (z.B. "HTTP/2 200")
  if (status.indexOf(" 200") < 0) {
    Serial.println("[HTTP] non-200");
    // Debug: Rest kurz ausgeben
    while (client.available()) Serial.write(client.read());
    client.stop();
    return false;
  }


  int contentLen = -1;
  while (client.connected()) {
    String line = client.readStringUntil('\n');
    if (line == "\r" || line.length() == 0) break;
    line.trim();
    if (line.startsWith("Content-Length:")) {
      contentLen = line.substring(strlen("Content-Length:")).toInt();
    }
  }

  File out = LittleFS.open(dstPath, "w");
  if (!out) {
    Serial.println("[FS] open for write failed");
    client.stop();
    return false;
  }

  const size_t expected = (size_t)display.width() * (size_t)display.height();

  uint8_t buf[1024];
  size_t total = 0;
  uint32_t lastData = millis();

  while (client.connected() || client.available()) {
    int avail = client.available();
    if (avail > 0) {
      int toRead = avail;
      if (toRead > (int)sizeof(buf)) toRead = (int)sizeof(buf);
      int n = client.read(buf, toRead);
      if (n > 0) {
        out.write(buf, n);
        total += (size_t)n;
        lastData = millis();
      }
    } else {
      if (millis() - lastData > 3000) break;
      delay(5);
    }
  }

  out.close();
  client.stop();

  Serial.printf("[HTTP] Saved %u bytes to %s\n", (unsigned)total, dstPath);

  if (contentLen >= 0 && (size_t)contentLen != total) {
    Serial.printf("[HTTP] content-length mismatch (%d != %u)\n", contentLen, (unsigned)total);
    return false;
  }

  if (total != expected) {
    Serial.printf("[HTTP] size mismatch (%u != %u)\n", (unsigned)total, (unsigned)expected);
    return false;
  }

  return true;
}

// -------------------------
// Wi-Fi connect (battery-friendly)
// -------------------------
bool connectWiFi() {
  Serial.printf("[WIFI] Connecting to %s\n", WIFI_SSID);

  WiFi.mode(WIFI_STA);

  // ✅ ADD: battery friendly WiFi settings
  WiFi.setSleep(true);
  esp_wifi_set_ps(WIFI_PS_MIN_MODEM);

  WiFi.begin(WIFI_SSID, WIFI_PASS);

  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
    if (millis() - start > 20000) {
      Serial.println("\n[WIFI] Timeout");
      return false;
    }
  }
  Serial.println();
  Serial.printf("[WIFI] Connected. IP: %s\n", WiFi.localIP().toString().c_str());
  return true;
}

// -------------------------
// ADD: cleanup + sleep helper
// -------------------------
void goToSleep() {
  display.hibernate();

  udp.stop();

  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);

  // ✅ ADD: set pins high-Z to avoid leakage into HAT/display
  SPI.end();

  pinMode(PIN_SPI_MOSI, INPUT);
  pinMode(PIN_SPI_SCK, INPUT);
  pinMode(PIN_EPD_CS, INPUT);
  pinMode(PIN_EPD_DC, INPUT);
  pinMode(PIN_EPD_RST, INPUT);
  pinMode(PIN_EPD_BUSY, INPUT);

  delay(50);

  esp_sleep_enable_timer_wakeup(SLEEP_TIME_US);
  Serial.printf("[SLEEP] Going to deep sleep for %llu minutes...\n", SLEEP_MINUTES);
  Serial.flush();
  esp_deep_sleep_start();
}

// -------------------------
// Main
// -------------------------
void setup() {
  Serial.begin(115200);
  delay(200);

  // ✅ ADD: reduce power peaks on battery
  setCpuFrequencyMhz(80);

  // SPI + display init
  SPI.begin(PIN_SPI_SCK, PIN_SPI_MISO, PIN_SPI_MOSI, PIN_EPD_CS);

  pinMode(PIN_EPD_BUSY, INPUT_PULLUP);  // wenn init hängt: INPUT testen

  display.init(115200);
  display.setRotation(2);
  display.setFullWindow();

  // FS init
  if (!LittleFS.begin(true)) {
    Serial.println("[FS] LittleFS begin failed");
  }

  // Wi-Fi + discovery + download
  bool ok = connectWiFi();
  IPAddress serverIp;
  uint16_t serverPort = 0;

  if (ok) {
    delay(500);
    ok = discoverServer(serverIp, serverPort);
  }

  if (ok) {
    ok = downloadToLittleFS(serverIp.toString(), serverPort, HTTP_PATH, LOCAL_BIN_PATH);
  }

  // Draw to e-paper (paged)
  display.firstPage();
  do {
    bool drawn = false;

    if (ok) {
      drawn = drawBinFromFS(LOCAL_BIN_PATH, 0, 0);
    }

    if (!drawn) {
      display.fillScreen(GxEPD_BLACK);
    }
  } while (display.nextPage());

  goToSleep();
}

void loop() {}
