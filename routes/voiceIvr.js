// backend/routes/voiceIvr.js
import express from "express";
import twilio from "twilio";
import Booking from "../models/bookingModel.js";
import { DateTime } from "luxon";

const router = express.Router();
const TZ = "Europe/London";
const VOICEMAIL_MAXLEN = 90;     // seconds
const LEG_TIMEOUT_SEC = 20;      // ring each target this long

const asArray = (x) => (Array.isArray(x) ? x : x ? [x] : []);

function withinWindow(book) {
  const now = DateTime.now().setZone(TZ);
  const from = book?.contactRouting?.activeFrom ? DateTime.fromJSDate(book.contactRouting.activeFrom).setZone(TZ) : null;
  const until = book?.contactRouting?.activeUntil ? DateTime.fromJSDate(book.contactRouting.activeUntil).setZone(TZ) : null;
  if (!from || !until) return false;
  return now >= from && now <= until;
}

function sayHang(twiml, text) {
  twiml.say({ voice: "alice" }, text);
  twiml.hangup();
}

async function loadBookingByCode(code) {
  if (!code) return null;
  return Booking.findOne({ "contactRouting.ivrCode": String(code) }).lean();
}

/**
 * Step 1: greet → gather 5-digit code
 */
router.post("/voice/ivr", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();

  const digits = (req.body?.Digits || "").replace(/\D+/g, "");
  if (!digits) {
    const g = twiml.gather({
      input: "dtmf",
      numDigits: 5,
      action: "/voice/ivr",
      method: "POST",
      timeout: 8,
    });
    g.say({ voice: "alice" }, "Thanks for calling The Supreme Collective emergency line. Please enter your five digit event code now.");
    twiml.say({ voice: "alice" }, "No input received.");
    return res.type("text/xml").send(twiml.toString());
  }

  const booking = await loadBookingByCode(digits);
  if (!booking) {
    const g = twiml.gather({
      input: "dtmf",
      numDigits: 5,
      action: "/voice/ivr",
      method: "POST",
      timeout: 8,
    });
    g.say({ voice: "alice" }, "Sorry, that code was not recognised. Please re enter your five digit event code.");
    twiml.say({ voice: "alice" }, "No input received.");
    return res.type("text/xml").send(twiml.toString());
  }

  if (!withinWindow(booking)) {
    if (booking?.contactRouting?.voicemail?.enabled) {
      twiml.say({ voice: "alice" }, "This line is only active from five p.m. the day before and on the day of the event. Please leave a short message.");
      twiml.record({
        maxLength: VOICEMAIL_MAXLEN,
        playBeep: true,
        trim: "trim-silence",
        action: "/voice/ivr/voicemail-complete",
        method: "POST",
      });
      return res.type("text/xml").send(twiml.toString());
    }
    sayHang(twiml, "This line is only active from five p.m. the day before and on the day of the event.");
    return res.type("text/xml").send(twiml.toString());
  }

  // Kick off the hunt at idx=0
  twiml.redirect({ method: "POST" }, `/voice/ivr/hunt?code=${encodeURIComponent(digits)}&idx=0`);
  return res.type("text/xml").send(twiml.toString());
});

/**
 * Step 2: hunt — dial targets sequentially
 */
router.post("/voice/ivr/hunt", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const code = String(req.query.code || req.body.code || "").replace(/\D+/g, "");
  const idx = Number(req.query.idx ?? req.body.idx ?? 0) || 0;

  const booking = await loadBookingByCode(code);
  if (!booking) {
    sayHang(twiml, "Booking not found.");
    return res.type("text/xml").send(twiml.toString());
  }

  const targets = asArray(booking?.contactRouting?.targets).sort((a, b) => (a?.priority ?? 1) - (b?.priority ?? 1));
  const target = targets[idx];

  if (!target) {
    // Exhausted → voicemail or hangup
    if (booking?.contactRouting?.voicemail?.enabled) {
      twiml.say({ voice: "alice" }, "No one could be reached. Please leave a short message after the beep.");
      twiml.record({
        maxLength: VOICEMAIL_MAXLEN,
        playBeep: true,
        trim: "trim-silence",
        action: "/voice/ivr/voicemail-complete",
        method: "POST",
      });
    } else {
      sayHang(twiml, "No one could be reached at this time. Goodbye.");
    }
    return res.type("text/xml").send(twiml.toString());
  }

  // Dial this target, on result go to /hunt-result to decide next step
  const callerId = req.body?.To || undefined; // present your shared IVR number
  const recordFlag = booking?.contactRouting?.recordingEnabled ? "record-from-answer" : "do-not-record";

  const dial = twiml.dial({
    callerId,
    record: recordFlag,
    timeout: LEG_TIMEOUT_SEC,
    action: `/voice/ivr/hunt-result?code=${encodeURIComponent(code)}&idx=${idx}`,
    method: "POST",
    answerOnBridge: true,
  });

  dial.number(target.phone);
  return res.type("text/xml").send(twiml.toString());
});

/**
 * Step 3: handle leg result — advance if needed
 */
router.post("/voice/ivr/hunt-result", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const code = String(req.query.code || req.body.code || "").replace(/\D+/g, "");
  const idx = Number(req.query.idx ?? req.body.idx ?? 0) || 0;

  // Twilio sends DialCallStatus: completed | no-answer | busy | failed | canceled
  const status = String(req.body?.DialCallStatus || "").toLowerCase();

  if (status === "completed") {
    // Call connected — do nothing; Twilio ends TwiML after leg completes.
    return res.type("text/xml").send(twiml.toString());
  }

  // Otherwise, try the next target
  const nextIdx = idx + 1;
  twiml.redirect({ method: "POST" }, `/voice/ivr/hunt?code=${encodeURIComponent(code)}&idx=${nextIdx}`);
  return res.type("text/xml").send(twiml.toString());
});

/**
 * Optional: handle voicemail completion (store/email RecordingUrl)
 */
router.post("/voice/ivr/voicemail-complete", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: "alice" }, "Thank you. Goodbye.");
  // You can read req.body.RecordingUrl / RecordingDuration and attach to the booking here.
  return res.type("text/xml").send(twiml.toString());
});

export default router;