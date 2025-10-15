// controllers/googleController.js
import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import { hashBase36 } from "../utils/hash.js";


const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];



function makePersonalEventId({ actId, dateISO, email }) {
  const act  = String(actId ?? "0").toLowerCase();
  const date = String(dateISO ?? "0").replace(/[^0-9]/g, ""); // 20260626
  const mail = String(email ?? "").toLowerCase();

  // Base token; will clamp to allowed charset
  let token = hashBase36(mail); // [a-z0-9], may include w-z

  // Allow only [a-v0-9]; clamp w-z -> v, drop anything else
  const toAllowed = (s) => s
    .toLowerCase()
    .replace(/[wxyz]/g, "v")
    .replace(/[^a-v0-9]/g, "");

  const id = toAllowed(`enq${date}${act}${token}`);
  const padded = (id.length < 5) ? (id + "enqvv").slice(0, 5) : id;
  return padded.slice(0, 100);
}


export const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Mask a token for logs
const mask = (s = "", keep = 6) =>
  s ? `${s.slice(0, keep)}…${s.slice(-keep)}` : "(empty)";

// ---- BEGIN REPLACE: quick auth check + safe boot guard ----
export const debugGoogleAuth = async (label = "debug") => {
  try {
    const cid  = process.env.GOOGLE_CLIENT_ID || "";
    const csec = process.env.GOOGLE_CLIENT_SECRET || "";
    const ruri = process.env.GOOGLE_REDIRECT_URI || "";
    const rtok = process.env.GOOGLE_REFRESH_TOKEN || "";

    // What env did we load?
    console.log(`🔧 [${label}] GOOGLE_REDIRECT_URI:`, ruri || "(missing)");
    console.log(`🔧 [${label}] GOOGLE_CLIENT_ID:`, cid || "(missing)");
    console.log(`🔧 [${label}] GOOGLE_REFRESH_TOKEN:`, mask(rtok, 10));

    // Basic validation (prevents confusing invalid_client later)
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

    // What does the client currently have?
    console.log(`🔧 [${label}] oauth2Client.credentials (masked):`, {
      refresh_token: mask(oauth2Client.credentials?.refresh_token, 10),
      access_token:  mask(oauth2Client.credentials?.access_token, 10),
      expiry_date:   oauth2Client.credentials?.expiry_date || null,
    });

    // Try to use the refresh_token
    const accessToken = await oauth2Client.getAccessToken();
    console.log(`✅ [${label}] getAccessToken() OK:`, mask(accessToken?.token || String(accessToken), 10));
    return true;
  } catch (err) {
    const msg = err?.message || String(err);
    console.error(`❌ [${label}] getAccessToken() failed:`, msg);
    // When it’s truly client mismatch, Google returns { error: 'invalid_client', error_description: 'Unauthorized' }
    if (err?.response?.data) console.error('❌ [google] response.data:', err.response.data);
    return false;
  }
};

// Prefer the refresh token from env at boot (if present)
if (process.env.GOOGLE_REFRESH_TOKEN) {
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
}

// Only run the check when we have all three critical env vars set
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

// On boot, prefer the refresh token from env
if (process.env.GOOGLE_REFRESH_TOKEN) {
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
}




// (Optional) log when tokens refresh; helpful during "invalid_grant" debugging
oauth2Client.on('tokens', (tokens) => {
  if (tokens.refresh_token) {
    console.log('🔁 Received new refresh_token (store this safely):', tokens.refresh_token);
  }
  if (tokens.access_token) {
    console.log('✅ Access token refreshed');
  }
});

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

export const getAuthUrl = (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
  res.redirect(authUrl);
};

export const oauth2Callback = async (req, res) => {
  const code = req.query.code;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // You’ll see refresh_token only on the first consent (or when prompt=consent)
    console.log('🔐 Tokens:', tokens);
    res.send('Authentication successful! You can close this tab.');
  } catch (error) {
    console.error('❌ Error exchanging code for tokens:', error.message);
    res.status(500).send('Authentication failed');
  }
};


// --- small helpers for rate limits -----------------------------------------
const _lastHitByEmail = new Map();

async function throttlePerRecipient(email, minGapMs = 400) {
  if (!email) return;
  const now = Date.now();
  const last = _lastHitByEmail.get(email) || 0;
  const wait = Math.max(0, last + minGapMs - now);
  if (wait) await new Promise(r => setTimeout(r, wait));
  _lastHitByEmail.set(email, Date.now());
}

async function withBackoff(fn, { tries = 5, base = 300 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      const code = e?.code || e?.status;
      const rate = code === 403 || code === 429 || /rate limit/i.test(e?.message || "");
      if (!rate || attempt >= tries - 1) throw e;
      const delay = base * Math.pow(2, attempt) + Math.floor(Math.random() * 150);
      await new Promise(r => setTimeout(r, delay));
      attempt++;
    }
  }
}


// Coerce to string and strip null/undefined
const _asStr = (v) => (v === undefined || v === null ? "" : String(v));
const _cleanPrivate = (obj = {}) =>
  Object.fromEntries(
    Object.entries(obj)
      .filter(([_, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, String(v)])
  );

/**
 * Create/update ONE personal enquiry event for { actId, dateISO, email }.
 * - Keeps attendees to just this musician.
 * - Appends a single line to description (idempotent).
 * - Uses deterministic event id so subsequent calls patch the same event.
 */
export async function createCalendarInvite({
  enquiryId,         // optional, for traceability
  actId,             // required
  dateISO,           // 'YYYY-MM-DD'
  email,             // musician email (required)
  summary = "TSC: Enquiry", // default title
  description = "",  // optional freeform
  startTime,         // optional ISO, defaults 17:00
  endTime,           // optional ISO, defaults 23:59
  extendedProperties = {},
  address = "TBC",   // optional
  fee = null,        // optional numeric
}) {
  console.log("📅 [createCalendarInvite] called with:", {
    actId, dateISO, email, address, fee,
  });

  if (!actId || !dateISO || !email) {
    throw new Error("createCalendarInvite requires actId, dateISO, and email");
  }

  // Prep Google client + calendar
  const cal = google.calendar({ version: "v3", auth: oauth2Client });
// Determine calendar ID safely
let calendarId = "primary";
try {
  // For some accounts (esp. service accounts), "primary" isn’t valid — we list calendars to find one
  const { data } = await cal.calendarList.list({ maxResults: 1 });
  const first = data.items?.[0]?.id;
  if (first) calendarId = first;
  console.log(`📅 Using calendarId: ${calendarId}`);
} catch (err) {
  console.warn("⚠️ Falling back to 'primary' calendar due to lookup error:", err.message);
}
  // ✅ Deterministic per-musician event ID
  const eventId = makePersonalEventId({ actId, dateISO, email });

  // ✅ Format start/end times
  const start = startTime || `${dateISO}T17:00:00.000Z`;
  const end = endTime || `${dateISO}T23:59:00.000Z`;

  // ✅ Format readable line for description
  const detailsLine =
    `• ${new Date(dateISO).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    })} – ${address}${fee ? ` (£${fee})` : ""}`;

  const privateProps = {
    ..._cleanPrivate(extendedProperties.private),
    actId: String(actId),
    dateISO,
    kind: "enquiry_personal",
    owner: email.toLowerCase(),
    enquiryId: enquiryId || "",
  };

  // --- Ensure spacing between API calls ---
  await throttlePerRecipient(email);

  try {
    // 🔍 Try to PATCH if existing event found
    const getRes = await withBackoff(() =>
      cal.events.get({ calendarId, eventId })
    );
    const ev = getRes.data || {};

    // Merge descriptions idempotently
    const existingDesc = ev.description || "";
    const lines = new Set(existingDesc.split(/\r?\n/).map(l => l.trim()).filter(Boolean));
    if (description) lines.add(description.trim());
    lines.add(detailsLine);
    const mergedDesc = Array.from(lines).join("\n");

    // Update attendees (ensure only this musician)
    const attendees = [{ email: email.toLowerCase() }];

    const patchBody = {
      summary: ev.summary || summary,
      description: mergedDesc,
      attendees,
      extendedProperties: { private: { ...(ev.extendedProperties?.private || {}), ...privateProps } },
    };

    console.log("🩹 [createCalendarInvite] PATCH existing event:", { eventId, attendees });
    const patch = await withBackoff(() =>
      cal.events.patch({
        calendarId,
        eventId,
        requestBody: patchBody,
        sendUpdates: "all",
      })
    );
    return { event: patch.data, created: false };
  } catch (e) {
    // If not found (404), we create it fresh
    if (e?.code !== 404) {
      console.error("❌ [createCalendarInvite] Error fetching existing event:", e.message);
      throw e;
    }
  }

  // 🆕 Create a new event if none found
  const insertBody = {
    id: eventId,
    summary,
    description: [description, detailsLine].filter(Boolean).join("\n"),
    start: { dateTime: start, timeZone: "Europe/London" },
    end: { dateTime: end, timeZone: "Europe/London" },
    attendees: [{ email: email.toLowerCase() }],
    extendedProperties: { private: privateProps },
    guestsCanModify: false,
    guestsCanInviteOthers: false,
    guestsCanSeeOtherGuests: false,
  };

  console.log("🆕 [createCalendarInvite] INSERT new event:", { eventId, email });
  try {
    const ins = await withBackoff(() =>
      cal.events.insert({
        calendarId,
        requestBody: insertBody,
        sendUpdates: "all",
      })
    );
    console.log(`✅ Event created for ${email}:`, ins.data.htmlLink);
    return { event: ins.data, created: true };
  } catch (e) {
    console.error("❌ [createCalendarInvite] INSERT failed:", e.message);
    throw e;
  }
}

/**
 * Optional helper you can call later to force-ensure an attendee is present.
 */
export async function updateCalendarEvent({ eventId, ensureAttendees = [] }) {
  if (!eventId || !ensureAttendees.length) return null;
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  const calendarId = "primary";

  const ev = await calendar.events.get({ calendarId, eventId });
  const existing = ev.data;
  const all = new Map(
    (existing.attendees || []).map(a => [a.email.toLowerCase(), a])
  );
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
  const watchResponse = await calendar.events.watch({
    calendarId: 'primary',
    requestBody: {
      id: uuidv4(),            // unique channel id
      type: 'web_hook',
      address: process.env.GOOGLE_WEBHOOK_URL, // your public https webhook
    },
  });

  console.log('✅ Webhook registered:', watchResponse.data);
  return watchResponse.data;
};

export const getCalendarEvent = async (eventId) => {
  const res = await calendar.events.get({
    calendarId: 'primary',
    eventId,
  });
  return res.data;
};

// --- Booking: ensure 1 event per act+date, append description lines, add attendees ---

/**
 * Find (or create) a single "TSC: Confirmed Booking" event for a given act and ISO date.
 * Returns { event, created }.
 */
export const ensureBookingEvent = async ({ actId, dateISO, address }) => {
  // Validate auth is ready
  const ok = await debugGoogleAuth("ensureBookingEvent");
  if (!ok) throw new Error("Google auth not ready (refresh token issue)");

  // Search window = whole day (UTC times are fine; we only care about same calendar day)
  const start = new Date(`${dateISO}T00:00:00.000Z`);
  const end = new Date(`${dateISO}T23:59:59.000Z`);

  // Try find an existing event for that day containing our private key actId
  const { data } = await calendar.events.list({
    calendarId: "primary",
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    maxResults: 50,
    singleEvents: false,
    showDeleted: false,
    q: "TSC:", // narrows results slightly
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
    // Make sure the summary is correct (upgrade if needed)
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

  // Create it
  const newEvt = {
    summary: "TSC: Confirmed Booking",
    description: `Booking created • ${address || ""}`,
    start: { dateTime: `${dateISO}T17:00:00.000Z` },
    end:   { dateTime: `${dateISO}T23:59:00.000Z` },
    attendees: [], // we’ll add people as they say YES
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

/**
 * Append a line to the event description (idempotent-ish by not duplicating exact lines).
 */
export const appendLineToEventDescription = async ({ eventId, line }) => {
  const { data: ev } = await calendar.events.get({ calendarId: "primary", eventId });
  const desc = ev.description || "";
  const lines = new Set(desc.split(/\r?\n/).map(s => s.trim()).filter(Boolean));
  if (!lines.has(line.trim())) {
    const merged = [ ...lines, line ].join("\n");
    await calendar.events.patch({
      calendarId: "primary",
      eventId,
      requestBody: { description: merged },
      sendUpdates: "none",
    });
  }
};

/**
 * Add an attendee (if not already present).
 */
export const addAttendeeToEvent = async ({ eventId, email }) => {
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

export async function cancelCalendarInvite({ eventId, actId, dateISO, email }) {
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  const calendarId = "primary";

  // If we already know the id, cancel directly.
  if (eventId) {
    return calendar.events.patch({
      calendarId,
      eventId,
      requestBody: { status: "cancelled" }, // cancels & notifies
      sendUpdates: "all",
    });
  }

  // Otherwise find the per-musician enquiry event for that day + act
  if (!actId || !dateISO || !email) return null;

  const dayStart = new Date(`${dateISO}T00:00:00.000Z`).toISOString();
  const dayEnd   = new Date(`${dateISO}T23:59:59.000Z`).toISOString();

  const { data } = await calendar.events.list({
    calendarId,
    timeMin: dayStart,
    timeMax: dayEnd,
    singleEvents: true,
    q: "TSC: Enquiry",
    maxResults: 100,
  });

  const items = data.items || [];
  const target = items.find(ev => {
    const priv = ev.extendedProperties?.private || {};
    const matchesPriv = String(priv.actId||"") === String(actId)
                     && String(priv.dateISO||"").slice(0,10) === String(dateISO).slice(0,10);
    const hasThisAttendee = (ev.attendees||[]).some(a => (a.email||"").toLowerCase() === String(email).toLowerCase());
    return matchesPriv && hasThisAttendee;
  });

  if (!target) return null;

  return calendar.events.patch({
    calendarId,
    eventId: target.id,
    requestBody: { status: "cancelled" },
    sendUpdates: "all",
  });
}