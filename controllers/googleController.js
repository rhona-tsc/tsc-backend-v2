// controllers/googleController.js
import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import { hashBase36 } from "../utils/hash.js";
import AvailabilityModel from '../models/availabilityModel.js';
import { toE164 } from '../utils/twilioClient.js';
import crypto from "crypto";

const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

// 🧠 Throttle map to prevent duplicate rapid invites per email
const _lastHitByEmail = new Map();

function cleanPrivate(obj) {
  if (!obj || typeof obj !== "object") return {};
  const cleaned = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue; // skip null/undefined
    // Google Calendar's private properties must be strings
    cleaned[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  return cleaned;
}


function makePersonalEventId({ email, dateISO }) {
  if (!email || !dateISO)
    throw new Error("makePersonalEventId requires email and dateISO");

  // Normalize and trim the email for readability (first 10–15 chars)
  const normEmail = email.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 15);
  const normDate = dateISO.replace(/-/g, "");

  // Add a short hash to guarantee uniqueness and meet Google ID rules
  const hash = crypto
    .createHash("md5")
    .update(email + dateISO)
    .digest("hex")
    .slice(0, 6);

  // ✅ Google-safe eventId: alphanumeric, under 64 chars, deterministic per email+date
  return `tsc_${normEmail}_${hash}_${normDate}`;
}

export const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const mask = (s = "", keep = 6) =>
  s ? `${s.slice(0, keep)}…${s.slice(-keep)}` : "(empty)";

export const debugGoogleAuth = async (label = "debug") => {
  console.log(`😈 (controllers/googleController.js) debugGoogleAuth called at`, new Date().toISOString(), { label });

  try {
    const cid  = process.env.GOOGLE_CLIENT_ID || "";
    const csec = process.env.GOOGLE_CLIENT_SECRET || "";
    const ruri = process.env.GOOGLE_REDIRECT_URI || "";
    const rtok = process.env.GOOGLE_REFRESH_TOKEN || "";

    console.log(`🔧 [${label}] GOOGLE_REDIRECT_URI:`, ruri || "(missing)");
    console.log(`🔧 [${label}] GOOGLE_CLIENT_ID:`, cid || "(missing)");
    console.log(`🔧 [${label}] GOOGLE_REFRESH_TOKEN:`, mask(rtok, 10));

    if (!cid || !csec) {
      console.error(`❌ [${label}] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET.`);
      return false;
    }
    if (!ruri) {
      console.error(`❌ [${label}] Missing GOOGLE_REDIRECT_URI.`);
      return false;
    }
    if (!rtok) {
      console.error(`❌ [${label}] Missing GOOGLE_REFRESH_TOKEN (authorize once to obtain).`);
      return false;
    }

    console.log(`🔧 [${label}] oauth2Client.credentials (masked):`, {
      refresh_token: mask(oauth2Client.credentials?.refresh_token, 10),
      access_token:  mask(oauth2Client.credentials?.access_token, 10),
      expiry_date:   oauth2Client.credentials?.expiry_date || null,
    });

    const accessToken = await oauth2Client.getAccessToken();
    console.log(`✅ [${label}] getAccessToken() OK:`, mask(accessToken?.token || String(accessToken), 10));
    return true;
  } catch (err) {
    console.error(`❌ (controllers/googleController.js) debugGoogleAuth error:`, err.message);
    return false;
  }
};

if (process.env.GOOGLE_REFRESH_TOKEN) {
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
}

(async () => {
  const haveCore =
    !!process.env.GOOGLE_CLIENT_ID &&
    !!process.env.GOOGLE_CLIENT_SECRET &&
    !!process.env.GOOGLE_REDIRECT_URI;
  if (haveCore) {
    await debugGoogleAuth("boot");
  } else {
    console.warn("⚠️ [boot] Skipping Google auth check (missing env).");
  }
})();

oauth2Client.on('tokens', (tokens) => {
  console.log(`😈 (controllers/googleController.js) oauth2Client.on('tokens') fired at`, new Date().toISOString());
  if (tokens.refresh_token) console.log('🔁 Received new refresh_token (store this safely):', tokens.refresh_token);
  if (tokens.access_token) console.log('✅ Access token refreshed');
});

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

export const getAuthUrl = (req, res) => {
  console.log(`😈 (controllers/googleController.js) getAuthUrl called at`, new Date().toISOString());
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
  res.redirect(authUrl);
};

export const oauth2Callback = async (req, res) => {
  console.log(`😈 (controllers/googleController.js) oauth2Callback called at`, new Date().toISOString());
  const code = req.query.code;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    console.log('🔐 Tokens:', tokens);
    res.send('Authentication successful! You can close this tab.');
  } catch (error) {
    console.error('❌ (controllers/googleController.js) oauth2Callback error:', error.message);
    res.status(500).send('Authentication failed');
  }
};

// --- small helpers ---
async function throttlePerRecipient(email, minGapMs = 400) {
  console.log(`😈 (controllers/googleController.js) throttlePerRecipient called at`, new Date().toISOString(), { email });
  if (!email) return;
  const now = Date.now();
  const last = _lastHitByEmail.get(email) || 0;
  const wait = Math.max(0, last + minGapMs - now);
  if (wait) await new Promise(r => setTimeout(r, wait));
  _lastHitByEmail.set(email, Date.now());
}

async function withBackoff(fn, { tries = 5, base = 300 } = {}) {
  console.log(`😈 (controllers/googleController.js) withBackoff called at`, new Date().toISOString());
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      const code = e?.code || e?.status;
      const rate = code === 403 || code === 429 || /rate limit/i.test(e?.message || "");
      if (!rate || attempt >= tries - 1) throw e;
      const delay = base * Math.pow(2, attempt) + Math.floor(Math.random() * 150);
      console.warn(`😈 (controllers/googleController.js) withBackoff retrying after delay ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
      attempt++;
    }
  }
}

export async function createCalendarInvite({
  enquiryId,
  actId,
  dateISO,
  email,
  summary = "TSC: Enquiry",
  description = "",
  startTime,
  endTime,
  extendedProperties = {},
  address = "TBC",
  fee = null,
}) {
  console.log(`😈 (controllers/googleController.js) createCalendarInvite called at`, new Date().toISOString(), {
    actId, dateISO, email, address, fee,
  });

  if (!actId || !dateISO || !email) {
    throw new Error("createCalendarInvite requires actId, dateISO, and email");
  }

  const cal = google.calendar({ version: "v3", auth: oauth2Client });
  let calendarId = "primary";
  try {
    const { data } = await cal.calendarList.list({ maxResults: 1 });
    const first = data.items?.[0]?.id;
    if (first) calendarId = first;
    console.log(`📅 Using calendarId: ${calendarId}`);
  } catch (err) {
    console.warn("⚠️ Falling back to 'primary' calendar due to lookup error:", err.message);
  }

const eventId = makePersonalEventId({ email, dateISO }); // 👈 shared per vocalist/date
  const start = startTime || `${dateISO}T17:00:00.000Z`;
  const end = endTime || `${dateISO}T23:59:00.000Z`;



  const privateProps = {
    ...cleanPrivate(extendedProperties.private),
    actId: String(actId),
    dateISO,
    kind: "enquiry_personal",
    owner: email.toLowerCase(),
    enquiryId: enquiryId || "",
  };

  await throttlePerRecipient(email);

try {
  const getRes = await withBackoff(() => cal.events.get({ calendarId, eventId }));
  const ev = getRes.data || {};

  // 🧠 Merge description lines so multiple enquiries appear together
  const lines = new Set(
    (ev.description || "")
      .split(/\r?\n/)
      .concat(description)
      .filter(Boolean)
  );
  const mergedDesc = Array.from(lines).join("\n");

  // 🧩 Ensure attendee list (single vocalist)
  const attendees = [{ email: email.toLowerCase() }];

  const patchBody = {
    summary: ev.summary || summary,
    description: mergedDesc,
    attendees,
    extendedProperties: {
      private: { ...(ev.extendedProperties?.private || {}), ...privateProps },
    },
  };

  console.log("🔁 Patching shared event for vocalist/date:", eventId);
  const patch = await withBackoff(() =>
    cal.events.patch({
      calendarId,
      eventId,
      requestBody: patchBody,
      sendUpdates: "all",
    })
  );

  await AvailabilityModel.updateMany(
    {
      dateISO,
      musicianEmail: email.toLowerCase(),
    },
    {
      $set: {
        calendarEventId: patch.data.id,
        calendarInviteEmail: email.toLowerCase(),
        calendarInviteSentAt: new Date(),
        calendarStatus: "needsAction",
      },
    }
  );
  console.log("💾 Shared calendarEventId stored:", patch.data.id);

  return patch.data;
} catch (e) {
  if (e?.code !== 404) throw e;
}

  // ✅ Insert new event (with attendee invite)
const insertBody = {
  id: eventId,
  summary,
  description: description,
  start: { dateTime: start, timeZone: "Europe/London" },
  end: { dateTime: end, timeZone: "Europe/London" },
  attendees: [{ email: email.toLowerCase() }],
  sendUpdates: "all",
  extendedProperties: { private: privateProps },
  guestsCanModify: false,
  guestsCanInviteOthers: false,
  guestsCanSeeOtherGuests: false,
};

  console.log(`🆕 (controllers/googleController.js) createCalendarInvite INSERT new event`, { eventId, email });
  try {
    const ins = await withBackoff(() =>
      cal.events.insert({ calendarId, requestBody: insertBody, sendUpdates: "all" })
    );
    console.log(`✅ Event created and invite sent to ${email}:`, ins.data.htmlLink);
    // ✅ Persist new event ID to AvailabilityModel
try {
  const eventIdToSave = ins?.data?.id || eventId;
  await AvailabilityModel.updateOne(
  {
    actId,
    dateISO,
    $or: [
      { email: email.toLowerCase() },
      { calendarInviteEmail: email.toLowerCase() },
    ],
  },
  {
    $set: {
      calendarEventId: eventIdToSave,
      calendarInviteEmail: email.toLowerCase(),
      calendarInviteSentAt: new Date(),
      calendarStatus: "needsAction",
    },
  }

);
  console.log("💾 Stored new calendarEventId:", eventIdToSave, "for", email);
} catch (err) {
  console.warn("⚠️ Failed to store new calendarEventId:", err.message);
}
return ins.data;

  } catch (e) {
    console.error("❌ (controllers/googleController.js) createCalendarInvite insert failed:", e.message);
    throw e;
  }
}

export async function updateCalendarEvent({ eventId, ensureAttendees = [] }) {
  console.log(`😈 (controllers/googleController.js) updateCalendarEvent called at`, new Date().toISOString(), {
    eventId,
    ensureAttendees,
  });

  if (!eventId || !ensureAttendees.length) return null;
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  const calendarId = "primary";
  const ev = await calendar.events.get({ calendarId, eventId });
  const existing = ev.data;
  const all = new Map((existing.attendees || []).map(a => [a.email.toLowerCase(), a]));
  for (const e of ensureAttendees) {
    if (!e) continue;
    const key = String(e).toLowerCase();
    if (!all.has(key)) all.set(key, { email: key });
  }
  const attendees = Array.from(all.values());
  return calendar.events.patch({
    calendarId,
    eventId,
    requestBody: { attendees },
    sendUpdates: "all",
  });
}

export const watchCalendar = async () => {
  console.log(`😈 (controllers/googleController.js) watchCalendar called at`, new Date().toISOString());
  const watchResponse = await calendar.events.watch({
    calendarId: 'primary',
    requestBody: {
      id: uuidv4(),
      type: 'web_hook',
      address: process.env.GOOGLE_WEBHOOK_URL,
    },
  });
  console.log('✅ Webhook registered:', watchResponse.data);
  return watchResponse.data;
};

export const getCalendarEvent = async (eventId) => {
  console.log(`😈 (controllers/googleController.js) getCalendarEvent called at`, new Date().toISOString(), { eventId });
  const res = await calendar.events.get({
    calendarId: 'primary',
    eventId,
  });
  return res.data;
};

export const handleGoogleWebhook = async (req, res) => {
  console.log(`😈 (controllers/googleController.js) handleGoogleWebhook called at`, new Date().toISOString());
  console.log('📬 Google Calendar webhook:', req.headers['x-goog-resource-state']);
  res.status(200).send();

  try {
    const eventId = req.headers['x-goog-resource-uri']?.split('/events/')[1];
    const resourceState = req.headers['x-goog-resource-state'];

    if (resourceState === 'exists' && eventId) {
      const event = await getCalendarEvent(eventId);
      console.log('📅 Event updated:', event.summary, event.status);
      const declined = event.attendees?.some(a => a.responseStatus === 'declined');
      if (declined) console.log('🚫 Musician declined — clearing badge');
    }
  } catch (err) {
    console.error('❌ (controllers/googleController.js) handleGoogleWebhook failed:', err);
  }
};

export const ensureBookingEvent = async ({ actId, dateISO, address }) => {
  console.log(`😈 (controllers/googleController.js) ensureBookingEvent called at`, new Date().toISOString(), {
    actId, dateISO, address,
  });

  const ok = await debugGoogleAuth("ensureBookingEvent");
  if (!ok) throw new Error("Google auth not ready (refresh token issue)");

  const start = new Date(`${dateISO}T00:00:00.000Z`);
  const end = new Date(`${dateISO}T23:59:59.000Z`);
  const { data } = await calendar.events.list({
    calendarId: "primary",
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    maxResults: 50,
    singleEvents: false,
    showDeleted: false,
    q: "TSC:",
  });

  const items = data.items || [];
  let found = null;
  for (const ev of items) {
    const priv = ev.extendedProperties?.private || {};
    if (priv.actId === String(actId) && priv.kind === "booking") {
      found = ev;
      break;
    }
  }

  if (found) {
    if (found.summary !== "TSC: Confirmed Booking") {
      await calendar.events.patch({
        calendarId: "primary",
        eventId: found.id,
        requestBody: { summary: "TSC: Confirmed Booking" },
        sendUpdates: "all",
      });
      found.summary = "TSC: Confirmed Booking";
    }
    return { event: found, created: false };
  }

  const newEvt = {
    summary: "TSC: Confirmed Booking",
    description: `Booking created • ${address || ""}`,
    start: { dateTime: `${dateISO}T17:00:00.000Z` },
    end: { dateTime: `${dateISO}T23:59:00.000Z` },
    attendees: [],
    extendedProperties: {
      private: { actId: String(actId), dateISO, kind: "booking" },
    },
  };

  const ins = await calendar.events.insert({
    calendarId: "primary",
    requestBody: newEvt,
    sendUpdates: "all",
  });

  return { event: ins.data, created: true };
};

export const appendLineToEventDescription = async ({ eventId, line }) => {
  console.log(`😈 (controllers/googleController.js) appendLineToEventDescription called at`, new Date().toISOString(), {
    eventId, line,
  });

  const { data: ev } = await calendar.events.get({ calendarId: "primary", eventId });
  const desc = ev.description || "";
  const lines = new Set(desc.split(/\r?\n/).map(s => s.trim()).filter(Boolean));
  if (!lines.has(line.trim())) {
    const merged = [...lines, line].join("\n");
    await calendar.events.patch({
      calendarId: "primary",
      eventId,
      requestBody: { description: merged },
      sendUpdates: "none",
    });
  }
};

export const addAttendeeToEvent = async ({ eventId, email }) => {
  console.log(`😈 (controllers/googleController.js) addAttendeeToEvent called at`, new Date().toISOString(), {
    eventId, email,
  });

  const { data: ev } = await calendar.events.get({ calendarId: "primary", eventId });
  const attendees = Array.isArray(ev.attendees) ? ev.attendees : [];
  if (!attendees.find(a => a.email?.toLowerCase() === email.toLowerCase())) {
    attendees.push({ email });
    await calendar.events.patch({
      calendarId: "primary",
      eventId,
      requestBody: { attendees },
      sendUpdates: "all",
    });
  }
};

export async function cancelCalendarInvite({ eventId, dateISO, email }) {
  console.log("🗓️ cancelCalendarInvite called:", { eventId, dateISO, email });
  const cal = google.calendar({ version: "v3", auth: oauth2Client });
  const calendarId = "primary";

  // 🧩 Shared ID fallback
  const sharedId = eventId || makePersonalEventId({ email, dateISO });

  try {
    await cal.events.patch({
      calendarId,
      eventId: sharedId,
      requestBody: { status: "cancelled" },
      sendUpdates: "all",
    });
    console.log("✅ Cancelled shared calendar event:", sharedId);
  } catch (err) {
    console.warn("⚠️ Shared event not found for cancel:", sharedId, err.message);
  }
}