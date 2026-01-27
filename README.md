
# E-Ink Dashboard (Node.js + ESP32)

Kurz: Node rendert ein 800×480 Dashboard (Wetter/Datum/Kalender/Quote) und liefert es als BIN aus.  
ESP32 findet den Server via UDP, lädt `/dashboard.bin`, zeichnet es aufs Waveshare 7.3" Spectra 6 und geht dann in Deep-Sleep.

## Struktur
- `e-ink-dashboard/` Node Server + Web-UI (OAuth, Zeitfenster, Uploads)
- `esp_client/` ESP32 Arduino Sketch

## Server Setup
```bash
cd e-ink-dashboard
npm install
node server.mjs
````

### .env (Beispiel)

```env
PORT=8888
HTTP_PORT=8889
BASE_URL=https://localhost:8888

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

SSL_KEY_PATH=./localhost+2-key.pem
SSL_CERT_PATH=./localhost+2.pem

TIMEZONE=Europe/Zurich
LOCALE=de-CH
LAT=47.3769
LON=8.5417
```

Wichtig: `BASE_URL` muss zum Google OAuth Redirect passen (`/oauth2callback`).

## URLs

* OAuth Start: `https://localhost:8888/auth`
* Dashboard UI: `https://localhost:8888/dashboard`
* BIN für ESP: `http://<server-ip>:8889/dashboard.bin`

## Zeitfenster-Logik

* **im Fenster** → Dashboard-BIN
* **ausserhalb** → zufälliges Upload-Bild
* `Von == Bis` → immer Dashboard

## Uploads

* UI unter `/dashboard`
* PNG/JPG
* Original wird nicht gespeichert, Bild wird auf 800×480 “cover-crop” + Spectra6-dithering optimiert und als PNG abgelegt.

## ESP32 (esp_client.ino)

* WLAN eintragen: `WIFI_SSID`, `WIFI_PASS`
* Discovery: UDP Broadcast `DASHBOARD_DISCOVERY` → Server antwortet `DASHBOARD_REPLY <port>`
* Download: `/dashboard.bin` nach LittleFS, dann rendern
* Deep sleep: standardmässig 45 Minuten

### BIN Format

800×480 Bytes, pro Pixel ein Farbindex `0..5`:
0=WHITE, 1=BLACK, 2=RED, 3=GREEN, 4=BLUE, 5=YELLOW
