// config.mjs
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// dotenv only for local/dev; production should inject env vars
if (process.env.NODE_ENV !== 'production') dotenv.config();

/* =========================
   Ports / URLs
========================= */

export const PORT = Number(process.env.PORT ?? 8888);           // HTTPS (OAuth / browser)
export const HTTP_PORT = Number(process.env.HTTP_PORT ?? 8889); // HTTP (ESP32)

export const BASE_URL = process.env.BASE_URL ?? `https://localhost:${PORT}`; // MUST match Google OAuth redirect
if (!BASE_URL.startsWith('https://')) {
  throw new Error(`BASE_URL must start with https:// (got: ${BASE_URL})`);
}

export const SSL_KEY_PATH = process.env.SSL_KEY_PATH;
export const SSL_CERT_PATH = process.env.SSL_CERT_PATH;

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

function requireFile(p, label) {
  if (!p) throw new Error(`Missing ${label}`);
  if (!fs.existsSync(p)) throw new Error(`${label} not found: ${p}`);
  return p;
}

requireFile(SSL_KEY_PATH, 'SSL_KEY_PATH');
requireFile(SSL_CERT_PATH, 'SSL_CERT_PATH');
if (!GOOGLE_CLIENT_ID) throw new Error('Missing GOOGLE_CLIENT_ID');
if (!GOOGLE_CLIENT_SECRET) throw new Error('Missing GOOGLE_CLIENT_SECRET');

/* =========================
   Dashboard config
========================= */

export const CONFIG = Object.freeze({
  width: 800,
  height: 480,
  lat: Number(process.env.LAT ?? 47.3769),
  lon: Number(process.env.LON ?? 8.5417),
  locale: process.env.LOCALE ?? 'de-CH',
  calendarId: process.env.CALENDAR_ID ?? 'primary',
  maxEvents: Number(process.env.MAX_EVENTS ?? 5),
  timeZone: process.env.TIMEZONE ?? 'Europe/Zurich',
});

export const TOKEN_PATH = path.resolve(process.env.TOKEN_PATH ?? './google_token.json');
export const PALETTE_PATH = path.resolve(process.env.PALETTE_PATH ?? './palette_spectra6.png');

// Schedule + uploads persistence
export const DASHBOARD_SETTINGS_PATH = path.resolve(process.env.DASHBOARD_SETTINGS_PATH ?? './dashboard_settings.json');
export const UPLOAD_DIR = path.resolve(process.env.DASHBOARD_UPLOAD_DIR ?? './dashboard_uploads');

export const DEFAULT_SETTINGS = Object.freeze({
  // minutes since midnight (local TZ)
  fromMin: 7 * 60,   // 07:00
  toMin: 22 * 60,    // 22:00
});

/* =========================
   Helpers
========================= */

export function clampInt(n, lo, hi) {
  n = Math.floor(n);
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

export function parseHHMM(v) {
  const m = String(v ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

export function fmtHHMM(min) {
  const hh = String(Math.floor(min / 60)).padStart(2, '0');
  const mm = String(min % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function getNowMinutesInTZ() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CONFIG.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const hh = Number(parts.find(p => p.type === 'hour')?.value ?? '0');
  const mm = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
  return hh * 60 + mm;
}

export function isInWindow(nowMin, fromMin, toMin) {
  // supports windows that pass midnight (e.g. 22:00 -> 06:00)
  if (fromMin === toMin) return true; // "always"
  if (fromMin < toMin) return nowMin >= fromMin && nowMin < toMin;
  return nowMin >= fromMin || nowMin < toMin;
}
