// server.mjs  (Node 18+)
// deps: npm i express googleapis canvas dotenv multer
import express from 'express';
import fs from 'fs';
import https from 'https';
import path from 'path';
import dgram from 'dgram';

import {
  PORT,
  HTTP_PORT,
  BASE_URL,
  SSL_KEY_PATH,
  SSL_CERT_PATH,
  CONFIG,
  UPLOAD_DIR,
  TOKEN_PATH,
  parseHHMM,
  fmtHHMM,
  getNowMinutesInTZ,
  isInWindow,
} from './config.mjs';

import { registerOAuthRoutes, isAuthed } from './google.mjs';

import {
  readSettings,
  writeSettings,
  upload,
  handleSingleImageUpload,
  listUploads,
  renderDashboardBinRequired,
  renderRandomUploadBinOrDashboardFallback,
} from './dashboard.mjs';

/* =========================
   Apps
========================= */

const appHttps = express(); // OAuth + dashboard UI
const appHttp  = express(); // client only (ESP32)

appHttps.use(express.urlencoded({ extended: true }));
appHttps.use(express.json());

/* =========================
   OAuth routes
========================= */

registerOAuthRoutes(appHttps);

/* =========================
   HTTPS: Dashboard UI + Settings + Uploads
========================= */

appHttps.use('/uploads', express.static(UPLOAD_DIR));

appHttps.get('/dashboard', (req, res) => {
  const authed = isAuthed();
  const s = readSettings();
  const uploads = listUploads();

  const html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Dashboard Settings</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      margin: 0;
      padding: 24px;
      background: #f8f9fa;
      color: #1a1a1a;
    }
    .container {
      max-width: 960px;
      margin: 0 auto;
    }
    h1 {
      font-size: 28px;
      font-weight: 600;
      margin: 0 0 24px 0;
      color: #1a1a1a;
    }
    .card {
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .card h2 {
      font-size: 18px;
      font-weight: 600;
      margin: 0 0 16px 0;
      color: #1a1a1a;
    }
    .card p {
      margin: 8px 0;
      line-height: 1.5;
    }
    .row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
    }
    label {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      font-size: 14px;
      font-weight: 500;
    }
    input[type="time"],
    input[type="file"] {
      padding: 8px 12px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      font-size: 14px;
      background: white;
    }
    input[type="time"]:focus,
    input[type="file"]:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }
    button {
      padding: 8px 16px;
      border-radius: 8px;
      border: 1px solid #d1d5db;
      background: white;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.15s ease;
    }
    button:hover {
      background: #f9fafb;
      border-color: #9ca3af;
    }
    button:active {
      background: #f3f4f6;
    }
    .ok {
      color: #059669;
      font-weight: 600;
    }
    .bad {
      color: #dc2626;
      font-weight: 600;
    }
    .muted {
      color: #6b7280;
      font-size: 14px;
    }
    ul {
      padding-left: 20px;
      margin: 12px 0;
    }
    ul li {
      margin: 6px 0;
      color: #4b5563;
    }
    img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      grid-template-rows: repeat(2, auto);
      gap: 16px;
    }
    .grid .card {
      margin: 0;
      padding: 16px;
    }
    .grid .card b {
      font-size: 13px;
      word-break: break-all;
      display: block;
      margin-bottom: 12px;
    }
    small {
      color: #6b7280;
      font-size: 13px;
    }
    code {
      background: #f3f4f6;
      padding: 2px 8px;
      border-radius: 6px;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      color: #1f2937;
    }
    a {
      color: #3b82f6;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
    }
    .status-badge.connected {
      background: #d1fae5;
      color: #065f46;
    }
    .status-badge.disconnected {
      background: #fee2e2;
      color: #991b1b;
    }
    .drop-zone {
      border: 2px dashed #d1d5db;
      border-radius: 8px;
      padding: 32px;
      text-align: center;
      background: #f9fafb;
      transition: all 0.2s ease;
      cursor: pointer;
      margin-bottom: 16px;
    }
    .drop-zone:hover {
      border-color: #9ca3af;
      background: #f3f4f6;
    }
    .drop-zone.drag-over {
      border-color: #3b82f6;
      background: #eff6ff;
      border-style: solid;
    }
    .drop-zone-icon {
      font-size: 48px;
      margin-bottom: 12px;
      opacity: 0.5;
    }
    .drop-zone-text {
      color: #6b7280;
      font-size: 14px;
      margin: 8px 0;
    }
    .drop-zone-text strong {
      color: #3b82f6;
    }
  </style>
</head>
<body>
  <h1>Dashboard Settings</h1>
  <div class="container grid">
    <div class="card">
      <h2>Google Login</h2>
      <p>Status: ${authed ? '<span class="status-badge connected">✓ Verbunden</span>' : '<span class="status-badge disconnected">✗ Nicht verbunden</span>'}</p>
      ${authed ? `<p class="muted">Token: ${path.basename(TOKEN_PATH)}</p>` : `
        <p class="muted" style="margin: 16px 0">Bitte mit Google anmelden, damit Kalender-Events geladen werden können.</p>
        <a href="/auth"><button>Mit Google anmelden</button></a>
      `}
    </div>

    <div class="card">
      <h2>Auslieferungs-Zeitfenster</h2>
      <p class="muted">Zeitzone: <b>${CONFIG.timeZone}</b> • In diesem Fenster liefert <code>/dashboard.bin</code> das generierte Dashboard; ausserhalb werden Upload-Bilder zufällig geliefert.</p>
      <form method="post" action="/dashboard/settings" class="row" style="margin-top: 16px">
        <label>Von: <input type="time" name="from" value="${fmtHHMM(s.fromMin)}" required /></label>
        <label>Bis: <input type="time" name="to" value="${fmtHHMM(s.toMin)}" required /></label>
        <button type="submit">Speichern</button>
      </form>
      <small style="display: block; margin-top: 12px">Tipp: Wenn Von == Bis → immer Dashboard.</small>
    </div>

    <div class="card">
      <h2>Bild hochladen</h2>
      <form method="post" action="/dashboard/upload" enctype="multipart/form-data" id="uploadForm">
        <div class="drop-zone" id="dropZone">
          <div class="drop-zone-icon">📁</div>
          <div class="drop-zone-text"><strong>Klicken Sie hier</strong> oder ziehen Sie ein Bild hierher</div>
          <div class="drop-zone-text" style="font-size: 12px">PNG oder JPEG</div>
        </div>
        <input type="file" name="image" accept="image/png,image/jpeg" id="fileInput" style="display: none" required />
        <div class="row">
          <button type="button" onclick="document.getElementById('fileInput').click()">Datei auswählen</button>
          <button type="submit" id="uploadBtn" style="display: none">Upload</button>
          <span id="fileName" class="muted"></span>
        </div>
      </form>
      <p class="muted" style="margin-top: 12px">Das Original wird nicht gespeichert. Es wird direkt auf 800×480 zugeschnitten und als PNG gespeichert.</p>
    </div>

    <div class="card">
      <h2>Uploads (${uploads.length})</h2>
      ${uploads.length === 0 ? `<p class="muted">Noch keine Uploads.</p>` : `
        <div class="grid">
          ${uploads.map(u => `
            <div class="card">
              <b>${u.name}</b>
              <div style="margin: 12px 0">
                <a href="/uploads/${encodeURIComponent(u.name)}" target="_blank" rel="noreferrer">
                  <img src="/uploads/${encodeURIComponent(u.name)}" alt="${u.name}">
                </a>
              </div>
              <form method="post" action="/dashboard/delete">
                <input type="hidden" name="name" value="${u.name}">
                <button type="submit">Löschen</button>
              </form>
            </div>
          `).join('')}
        </div>
      `}
    </div>

  </div>

  <script>
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');
    const fileName = document.getElementById('fileName');
    const uploadForm = document.getElementById('uploadForm');

    // Click to select file
    dropZone.addEventListener('click', () => {
      fileInput.click();
    });

    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, preventDefaults, false);
      document.body.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Highlight drop zone when dragging over it
    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, () => {
        dropZone.classList.add('drag-over');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, () => {
        dropZone.classList.remove('drag-over');
      }, false);
    });

    // Handle dropped files
    dropZone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt.files;

      if (files.length > 0) {
        fileInput.files = files;
        handleFileSelect();
      }
    });

    // Handle file selection
    fileInput.addEventListener('change', handleFileSelect);

    function handleFileSelect() {
      if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        fileName.textContent = file.name;
        uploadBtn.style.display = 'inline-block';
        uploadForm.submit();
      }
    }
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

appHttps.post('/dashboard/settings', (req, res) => {
  const from = parseHHMM(req.body?.from);
  const to = parseHHMM(req.body?.to);

  if (from == null || to == null) {
    return res.status(400).send('Invalid time. Use HH:MM.');
  }

  writeSettings({ fromMin: from, toMin: to });
  res.redirect('/dashboard');
});

// SINGLE upload: field name "image"
appHttps.post('/dashboard/upload', upload.single('image'), async (req, res) => {
  try {
    await handleSingleImageUpload(req);
    res.redirect('/dashboard');
  } catch (e) {
    const status = e?.status || 400;
    res.status(status).send(`Upload error: ${e?.message || String(e)}`);
  }
});

appHttps.post('/dashboard/delete', (req, res) => {
  const name = String(req.body?.name ?? '');
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
    return res.status(400).send('Invalid filename.');
  }
  const p = path.join(UPLOAD_DIR, name);
  if (fs.existsSync(p)) {
    try { fs.unlinkSync(p); } catch {}
  }
  res.redirect('/dashboard');
});

// Multer / Request error handler (so it doesn't crash)
appHttps.use((err, req, res, next) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).send('Upload/Request error: File too large (limit is 25MB)');
  }
  res.status(400).send(`Upload/Request error: ${err.message || String(err)}`);
});

/* =========================
   HTTP: client only (/dashboard.bin)
========================= */

appHttp.get('/dashboard.bin', async (req, res) => {
  const mode = String(req.query?.mode ?? '').toLowerCase(); // optional: dashboard|random
  const s = readSettings();
  const nowMin = getNowMinutesInTZ();
  const inWindowNow = isInWindow(nowMin, s.fromMin, s.toMin);

  const shouldServeDashboard =
    mode === 'dashboard' ? true :
    mode === 'random' ? false :
    inWindowNow;

  try {
    const bin = shouldServeDashboard
      ? await renderDashboardBinRequired()
      : await renderRandomUploadBinOrDashboardFallback();

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(bin.length));
    res.send(bin);
  } catch (e) {
    if (e?.code === 'NOT_AUTHED') {
      return res
        .status(503)
        .send(`Not authenticated. Visit ${BASE_URL}/auth first. Or open ${BASE_URL}/dashboard`);
    }
    console.error('❌ /dashboard.bin', e);
    res.status(500).send('Error generating BIN');
  }
});

/* =========================
   Boot (HTTPS + HTTP)
========================= */

// HTTPS (Browser/OAuth + Dashboard UI)
const httpsServer = https.createServer(
  {
    key: fs.readFileSync(SSL_KEY_PATH),
    cert: fs.readFileSync(SSL_CERT_PATH),
  },
  appHttps,
);

httpsServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🔑 OAuth start: ${BASE_URL}/auth`);
  console.log(`🛠️ Dashboard UI: ${BASE_URL}/dashboard`);
});

// HTTP (Client/ESP)
appHttp.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`📦 BIN:  http://0.0.0.0:${HTTP_PORT}/dashboard.bin`);
});

/* =========================
   UDP Discovery responder
========================= */

const DISCOVERY_PORT = Number(process.env.DISCOVERY_PORT ?? 45454);
const DISCOVERY_MSG = 'DASHBOARD_DISCOVERY';

const udp = dgram.createSocket('udp4');

udp.on('error', (err) => {
  console.error('❌ UDP socket error:', err);
});

udp.on('message', (msg, rinfo) => {
  const text = msg.toString('utf8').trim();
  if (text !== DISCOVERY_MSG) return;

  const reply = Buffer.from(`DASHBOARD_REPLY ${HTTP_PORT}`, 'utf8');
  udp.send(reply, rinfo.port, rinfo.address, (e) => {
    if (e) console.error('❌ UDP reply send error:', e);
  });
});

udp.bind(DISCOVERY_PORT, '0.0.0.0', () => {
  udp.setBroadcast(true);
  console.log(`📡 UDP discovery listening on 0.0.0.0:${DISCOVERY_PORT}`);
});
