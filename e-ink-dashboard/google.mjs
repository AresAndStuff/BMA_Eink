// google.mjs
import fs from 'fs';
import { google } from 'googleapis';
import { BASE_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TOKEN_PATH, CONFIG } from './config.mjs';

export const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  `${BASE_URL}/oauth2callback`,
);

if (fs.existsSync(TOKEN_PATH)) {
  try {
    oauth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')));
  } catch (e) {
    console.warn('⚠️ Token file unreadable, ignoring:', e.message);
  }
}

export function isAuthed() {
  return Boolean(oauth2Client?.credentials?.refresh_token || oauth2Client?.credentials?.access_token);
}

function formatCalendarEvent(event) {
  const start = event.start?.dateTime || event.start?.date;
  const date = new Date(start);

  return {
    title: event.summary || '(Ohne Titel)',
    date,
    day: date.getDate(),
    isAllDay: !event.start?.dateTime,
    time: event.start?.dateTime
      ? date.toLocaleTimeString(CONFIG.locale, { hour: '2-digit', minute: '2-digit' })
      : 'Ganztägig',
  };
}

export async function getCalendarEventsRequired() {
  if (!isAuthed()) {
    const err = new Error('NOT_AUTHED');
    err.code = 'NOT_AUTHED';
    throw err;
  }

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const now = new Date();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const response = await calendar.events.list({
    calendarId: CONFIG.calendarId,
    timeMin: now.toISOString(),
    timeMax: endOfMonth.toISOString(),
    maxResults: CONFIG.maxEvents,
    singleEvents: true,
    orderBy: 'startTime',
  });

  return (response.data.items || []).map(formatCalendarEvent);
}

export function registerOAuthRoutes(appHttps) {
  appHttps.get('/auth', (req, res) => {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: ['https://www.googleapis.com/auth/calendar.readonly'],
    });
    res.redirect(authUrl);
  });

  appHttps.get('/oauth2callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('Missing ?code=');

    try {
      const { tokens } = await oauth2Client.getToken(String(code));

      const existing = fs.existsSync(TOKEN_PATH)
        ? JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'))
        : {};

      const merged = { ...existing, ...tokens };

      oauth2Client.setCredentials(merged);
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));

      res.status(200).send(`✅ Google Calendar verbunden. Token gespeichert.

Zur Dashboard-Config: ${BASE_URL}/dashboard`);
    } catch (e) {
      res.status(500).send(`❌ OAuth Fehler\n\n${String(e)}`);
    }
  });
}
