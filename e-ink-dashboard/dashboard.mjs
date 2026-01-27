// dashboard.mjs
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { createCanvas, loadImage } from 'canvas';

import {
  CONFIG,
  DASHBOARD_SETTINGS_PATH,
  UPLOAD_DIR,
  DEFAULT_SETTINGS,
  clampInt,
} from './config.mjs';

import { getCalendarEventsRequired } from './google.mjs';

// epdoptimize (Spectra6 / e-ink photo optimization)
import {
  ditherImage,
  getDefaultPalettes,
  getDeviceColors,
  replaceColors,
} from 'epdoptimize';

/* =========================
   Settings persistence
========================= */

export function readSettings() {
  try {
    if (!fs.existsSync(DASHBOARD_SETTINGS_PATH)) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(fs.readFileSync(DASHBOARD_SETTINGS_PATH, 'utf8'));
    const fromMin = Number(parsed.fromMin);
    const toMin = Number(parsed.toMin);
    if (!Number.isFinite(fromMin) || !Number.isFinite(toMin)) return { ...DEFAULT_SETTINGS };
    return { fromMin: clampInt(fromMin, 0, 24 * 60), toMin: clampInt(toMin, 0, 24 * 60) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(s) {
  const safe = {
    fromMin: clampInt(Number(s.fromMin), 0, 24 * 60),
    toMin: clampInt(Number(s.toMin), 0, 24 * 60),
  };
  fs.writeFileSync(DASHBOARD_SETTINGS_PATH, JSON.stringify(safe, null, 2));
  return safe;
}

/* =========================
   Uploads (store ONLY processed, no originals)
========================= */

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const upload = multer({
  storage: multer.memoryStorage(),             // <- original never hits disk
  limits: { fileSize: 25 * 1024 * 1024 },      // 25MB (change if you want)
  fileFilter: (req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/jpg'].includes(file.mimetype);
    cb(ok ? null : new Error('Only PNG/JPG allowed'), ok);
  },
});

function safeBaseName(name) {
  const ext = path.extname(name || '').toLowerCase();
  const base = (path.basename(name || 'image', ext) || 'image')
    .replace(/[^\w\-]+/g, '_')
    .slice(0, 40);
  return base || 'image';
}

/* =========================
   epdoptimize palette setup (Spectra6)
========================= */

function hexToRgb(hex) {
  const h = String(hex).trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

// Calibrated palette used for dithering decisions:
const CALIBRATED_PALETTE = getDefaultPalettes('spectra6');

// Device output colors (what the display really expects):
const DEVICE_COLORS_HEX = getDeviceColors('spectra6');
const DEVICE_PALETTE_RGB = DEVICE_COLORS_HEX.map(hexToRgb);

/* =========================
   Process upload with epdoptimize (dither + palette)
   - cover crop -> 800x480
   - dither to calibrated palette
   - replace to device colors
   - save ONLY processed PNG
========================= */

async function processAndSaveUpload(buffer, originalName) {
  const img = await loadImage(buffer);

  const W = CONFIG.width;
  const H = CONFIG.height;

  // Step 1: draw input image (cover crop) onto inputCanvas
  const inputCanvas = createCanvas(W, H);
  const ictx = inputCanvas.getContext('2d');
  ictx.imageSmoothingEnabled = true;
  ictx.fillStyle = '#ffffff';
  ictx.fillRect(0, 0, W, H);

  const scale = Math.max(W / img.width, H / img.height);
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const dx = (W - drawW) / 2;
  const dy = (H - drawH) / 2;
  ictx.drawImage(img, dx, dy, drawW, drawH);

  // Step 2: dither with epdoptimize into calibrated palette
  const ditheredCanvas = createCanvas(W, H);
  ditherImage(inputCanvas, ditheredCanvas, {
    ditheringType: 'errorDiffusion',
    errorDiffusionMatrix: 'floydSteinberg',
    serpentine: true,
    palette: CALIBRATED_PALETTE,
  });

  // Step 3: replace calibrated colors -> real device colors
  const preparedCanvas = createCanvas(W, H);
  replaceColors(ditheredCanvas, preparedCanvas, {
    originalColors: CALIBRATED_PALETTE,
    replaceColors: DEVICE_COLORS_HEX,
  });

  // Step 4: save ONLY processed result
  const base = safeBaseName(originalName);
  const outName = `${base}_${Date.now()}.png`;
  const outPath = path.join(UPLOAD_DIR, outName);

  fs.writeFileSync(outPath, preparedCanvas.toBuffer('image/png'));
  return { name: outName, path: outPath };
}

export async function handleSingleImageUpload(req) {
  if (!req.file?.buffer) {
    const err = new Error('No file uploaded');
    err.status = 400;
    throw err;
  }
  return processAndSaveUpload(req.file.buffer, req.file.originalname);
}

export function listUploads() {
  try {
    return fs.readdirSync(UPLOAD_DIR)
      .filter(f => /\.(png|jpe?g)$/i.test(f))
      .map(f => ({
        name: f,
        path: path.join(UPLOAD_DIR, f),
        mtimeMs: fs.statSync(path.join(UPLOAD_DIR, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return [];
  }
}

export function pickRandomUpload() {
  const files = listUploads();
  if (files.length === 0) return null;
  const idx = Math.floor(Math.random() * files.length);
  return files[idx];
}

/* =========================
   Weather + Quote + Month
========================= */

const WEATHER_TEXT = Object.freeze({
  0: 'SONNE',
  1: 'HEITER',
  2: 'WOLKEN',
  3: 'BEWÖLKT',
  45: 'NEBEL',
  48: 'NEBEL',
  51: 'NIESEL',
  53: 'NIESEL',
  55: 'NIESEL',
  61: 'REGEN',
  63: 'REGEN',
  65: 'REGEN',
  71: 'SCHNEE',
  73: 'SCHNEE',
  75: 'SCHNEE',
  80: 'SCHAUER',
  81: 'SCHAUER',
  82: 'SCHAUER',
  95: 'GEWITTER',
  96: 'GEWITTER',
  99: 'GEWITTER',
});

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} for ${url}${text ? ` — ${text.slice(0, 200)}` : ''}`);
  }
  return res.json();
}

async function getWeatherData() {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${CONFIG.lat}&longitude=${CONFIG.lon}` +
    `&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto`;

  const data = await fetchJson(url);
  const code = data?.daily?.weathercode?.[0];

  return {
    iconText: WEATHER_TEXT[code] || 'WETTER',
    maxTemp: Math.round(data.daily.temperature_2m_max[0]),
    minTemp: Math.round(data.daily.temperature_2m_min[0]),
  };
}

async function getQuote() {
  const maxLength = 200;
  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const data = await fetchJson('https://zenquotes.io/api/random');
      const item = data?.[0];
      if (!item) continue;

      const quote = { content: item.q, author: item.a };
      if ((quote.content?.length ?? 9999) <= maxLength) return quote;
    } catch {
      // retry
    }
  }

  return { content: 'Heute ist ein guter Tag, um anzufangen.', author: 'Unbekannt' };
}

function getCalendarMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  return {
    monthName: now.toLocaleDateString(CONFIG.locale, { month: 'long', year: 'numeric' }),
    daysInMonth: lastDay.getDate(),
    startDayOfWeek: firstDay.getDay(), // Sunday=0
    currentDay: now.getDate(),
  };
}

export async function getDashboardDataRequired() {
  const [weather, quote, calendar, events] = await Promise.all([
    getWeatherData(),
    getQuote(),
    Promise.resolve(getCalendarMonth()),
    getCalendarEventsRequired(),
  ]);

  return { weather, quote, calendar, events };
}

/* =========================
   BIN mapping (0..5 indices)
   Now using Spectra6 DEVICE colors (from epdoptimize)
========================= */

function nearestPaletteIndex(r, g, b) {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < DEVICE_PALETTE_RGB.length; i++) {
    const p = DEVICE_PALETTE_RGB[i];
    const dr = r - p.r, dg = g - p.g, db = b - p.b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best; // 0..5
}

export function canvasToBin(canvas) {
  const ctx = canvas.getContext('2d');
  const { width: W, height: H } = canvas;
  const img = ctx.getImageData(0, 0, W, H);
  const data = img.data;

  const out = Buffer.allocUnsafe(W * H);
  let o = 0;

  for (let i = 0; i < data.length; i += 4) {
    out[o++] = nearestPaletteIndex(data[i], data[i + 1], data[i + 2]);
  }

  return out;
}

/* =========================
   Rendering dashboard canvas
========================= */

function wrapText(ctx, text, maxWidth) {
  const words = (text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width <= maxWidth) line = test;
    else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function renderDashboardCanvas({ weather, quote, calendar, events }) {
  const W = CONFIG.width;
  const H = CONFIG.height;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.textBaseline = 'top';
  ctx.imageSmoothingEnabled = false;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  const m = 18;
  const g = 14;
  const lw = 245;

  const lx = m;
  const ly = m;
  const lh = H - m * 2;

  const rx = lx + lw + g;
  const ry = m;
  const rw = W - m * 2 - lw - g;
  const rh = H - m * 2;

  const p = 14;
  const sg = 12;

  const wh = 90;
  const dh = 75;
  const eh = events.length > 0 ? 135 : 0;
  const qh = lh - wh - dh - eh - (events.length > 0 ? sg * 3 : sg * 2);

  let y = ly;

  function drawBox(x, y, w, h) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  function drawSectionHeader(text, x, y, w) {
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(text.toUpperCase(), x, y);

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + 14);
    ctx.lineTo(x + w - p * 2, y + 14);
    ctx.stroke();
  }

  // WEATHER
  drawBox(lx, y, lw, wh);
  drawSectionHeader('Wetter', lx + p, y + p, lw);

  ctx.fillStyle = '#000000';
  ctx.font = 'bold 22px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(weather.iconText, lx + lw / 2, y + 46);

  ctx.font = 'bold 24px Arial';
  ctx.fillText(`${weather.maxTemp}° / ${weather.minTemp}°`, lx + lw / 2, y + 72);

  y += wh + sg;

  // DATE
  drawBox(lx, y, lw, dh);
  drawSectionHeader('Datum', lx + p, y + p, lw);

  const now = new Date();
  const weekday = now.toLocaleDateString(CONFIG.locale, { weekday: 'long' });
  const dateStr = now.toLocaleDateString(CONFIG.locale, { day: 'numeric', month: 'long', year: 'numeric' });

  ctx.fillStyle = '#000000';
  ctx.font = 'bold 17px Arial';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(weekday, lx + p, y + 32);

  ctx.font = '12px Arial';
  ctx.fillText(dateStr, lx + p, y + 54);

  y += dh + sg;

  // EVENTS
  if (events.length > 0) {
    drawBox(lx, y, lw, eh);
    drawSectionHeader('Termine', lx + p, y + p, lw);

    let ey = y + 30;
    const maxW = lw - p * 2;
    const monthShort = calendar.monthName.split(' ')[0].substring(0, 3);

    for (let i = 0; i < Math.min(events.length, 2); i++) {
      const ev = events[i];

      ctx.fillStyle = '#000000';
      ctx.font = '10px Arial';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      const dateTime = ev.isAllDay ? `${ev.day}. ${monthShort}` : `${ev.day}. ${monthShort} • ${ev.time}`;
      ctx.fillText(dateTime, lx + p, ey);
      ey += 14;

      ctx.font = 'bold 12px Arial';
      const lines = wrapText(ctx, ev.title, maxW);
      for (let j = 0; j < Math.min(2, lines.length); j++) {
        ctx.fillText(lines[j], lx + p, ey);
        ey += 15;
      }

      if (i < Math.min(events.length, 2) - 1) {
        ey += 5;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(lx + p, ey);
        ctx.lineTo(lx + lw - p, ey);
        ctx.stroke();
        ey += 8;
      }
    }

    y += eh + sg;
  }

  // QUOTE
  drawBox(lx, y, lw, qh);
  drawSectionHeader('Motivation', lx + p, y + p, lw);

  ctx.fillStyle = '#000000';
  ctx.font = '12px Arial';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  const quoteLines = wrapText(ctx, quote.content, lw - p * 2);
  let qy = y + 30;

  const maxQuoteLines = Math.min(6, Math.floor((qh - 50) / 16));
  for (let i = 0; i < Math.min(maxQuoteLines, quoteLines.length); i++) {
    ctx.fillText(quoteLines[i], lx + p, qy);
    qy += 16;
  }

  ctx.font = 'italic 11px Arial';
  ctx.fillText(`— ${quote.author}`, lx + p, y + qh - 18);

  // CALENDAR GRID
  drawBox(rx, ry, rw, rh);

  ctx.fillStyle = '#000000';
  ctx.font = 'bold 20px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(calendar.monthName, rx + rw / 2, ry + 18);

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rx + 20, ry + 42);
  ctx.lineTo(rx + rw - 20, ry + 42);
  ctx.stroke();

  const weekdays = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const cp = 16;
  const hy = ry + 50;
  const gx = rx + cp;
  const gy = hy + 24;
  const gw = rw - cp * 2;
  const gh = rh - (gy - ry) - cp;

  const rows = 6;
  const cg = 4;
  const cw = Math.floor((gw - cg * 6) / 7);
  const ch = Math.floor((gh - cg * 5) / 6);

  ctx.font = 'bold 10px Arial';
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'middle';

  const colW = gw / 7;
  for (let i = 0; i < 7; i++) {
    ctx.fillText(weekdays[i], gx + i * colW + colW / 2, hy + 10);
  }

  const eventDays = Object.create(null);
  for (const ev of events) eventDays[ev.day] = true;

  let day = 1;
  const startOffset = calendar.startDayOfWeek;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < 7; col++) {
      const idx = row * 7 + col;
      if (idx < startOffset || day > calendar.daysInMonth) continue;

      const cx = gx + col * (cw + cg);
      const cy = gy + row * (ch + cg);

      const isToday = day === calendar.currentDay;
      const hasEvent = eventDays[day];

      if (isToday) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(cx, cy, cw, ch);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.strokeRect(cx, cy, cw, ch);
      } else {
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx, cy, cw, ch);
      }

      ctx.fillStyle = isToday ? '#ffffff' : '#000000';
      ctx.font = isToday ? 'bold 15px Arial' : '14px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(day), cx + cw / 2, cy + ch / 2 - 1);

      if (hasEvent) {
        ctx.fillStyle = isToday ? '#ffffff' : '#000000';
        ctx.beginPath();
        ctx.arc(cx + cw / 2, cy + ch - 6, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      day++;
    }
  }

  return { canvas };
}

export async function renderDashboardBinRequired() {
  const data = await getDashboardDataRequired();
  const { canvas } = renderDashboardCanvas(data);
  return canvasToBin(canvas);
}

export async function renderUploadFileToBin(filePath) {
  // Uploaded files are already processed by epdoptimize, but we still map to BIN
  const img = await loadImage(filePath);

  const W = CONFIG.width;
  const H = CONFIG.height;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);

  return canvasToBin(canvas);
}

export async function renderRandomUploadBinOrDashboardFallback() {
  const pick = pickRandomUpload();
  if (pick) return renderUploadFileToBin(pick.path);
  return renderDashboardBinRequired();
}
