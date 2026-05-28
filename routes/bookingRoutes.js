// routes/bookingRoutes.js
import express from "express";
import verifyToken from "../middleware/agentAuth.js";
import {
  createCheckoutSession,
  completeBooking,
  manualCreateBooking,
  markMusicianAsPaid,
  getBookingByRef,
  updateEventSheet,
  ensureEmergencyContact,
  completeBookingV2,
  previewContractHtml,
  generateContractPdf
} from "../controllers/bookingController.js";
import Booking from "../models/bookingModel.js";
import mongoose from "mongoose";
import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/*              POST /:id/ensure-emergency-contact                            */
/* -------------------------------------------------------------------------- */
router.post("/:id/ensure-emergency-contact", (req, res, next) => {
  console.log(`✅ (routes/bookingRoutes.js) POST /api/booking/:id/ensure-emergency-contact called at`, new Date().toISOString(), {
    id: req.params?.id,
    bodyKeys: Object.keys(req.body || {}),
  });
  next();
}, ensureEmergencyContact);

/* -------------------------------------------------------------------------- */
/*              POST /create-checkout-session                                 */
/* -------------------------------------------------------------------------- */
router.post("/create-checkout-session", (req, res, next) => {
  console.log(`✅ (routes/bookingRoutes.js) POST /api/booking/create-checkout-session called at`, new Date().toISOString(), {
    bodyKeys: Object.keys(req.body || {}),
  });
  next();
}, createCheckoutSession);

/* -------------------------------------------------------------------------- */
/*              GET /booking-complete                                         */
/* -------------------------------------------------------------------------- */
router.get("/booking-complete", (req, res, next) => {
  console.log(`✅ (routes/bookingRoutes.js) GET /api/booking/booking-complete called at`, new Date().toISOString(), {
    query: req.query,
  });
  next();
}, completeBookingV2);

// --------------------------------------------------------------------------
// Contract preview/pdf aliases (allows calling /api/bookings/:id/contract/*
// if this router is mounted at /api/bookings)
// --------------------------------------------------------------------------
router.get("/:id/contract/preview", previewContractHtml);
router.get("/:id/contract/pdf", generateContractPdf);

/* -------------------------------------------------------------------------- */
/*              GET /user/:userId                                             */
/* -------------------------------------------------------------------------- */
router.get("/user/:userId", async (req, res) => {
  console.log(`✅ (routes/bookingRoutes.js) GET /api/booking/user/:userId called at`, new Date().toISOString(), {
    userId: req.params.userId,
  });
  try {
    const bookings = await Booking.find({ userId: req.params.userId }).sort({ createdAt: -1 });
    res.json(bookings);
  } catch (error) {
    console.error("❌ Error fetching bookings:", error);
    res.status(500).json({ message: "Failed to fetch bookings" });
  }
});

/* -------------------------------------------------------------------------- */
/*              GET /booking/:id                                              */
/* -------------------------------------------------------------------------- */
router.get("/booking/:id", async (req, res) => {
  console.log(`GET /api/booking/booking/:id called`, { id: req.params.id });

  const id = req.params.id.trim();

  try {
    // Helper: is valid ObjectId?
    const isObjectId = mongoose.Types.ObjectId.isValid(id) &&
      String(new mongoose.Types.ObjectId(id)) === id;

    let booking;

    if (isObjectId) {
      // Try using _id
      booking = await Booking.findById(id);
    } else {
      // Try using bookingId
      booking = await Booking.findOne({ bookingId: id });
    }

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    res.json(booking);
  } catch (err) {
    console.error("❌ booking/:id fetch error:", err);
    res.status(500).json({ message: "Failed to fetch booking" });
  }
});

/* -------------------------------------------------------------------------- */
/*              GET /booking/by-ref/:bookingId                                */
/* -------------------------------------------------------------------------- */
router.get("/by-ref/:bookingId", async (req, res) => {
  console.log(`✅ (routes/bookingRoutes.js) GET /api/booking/by-ref/:bookingId called at`, 
    new Date().toISOString(), 
    { bookingId: req.params.bookingId }
  );

  try {
    const booking = await Booking.findOne({ bookingId: req.params.bookingId });
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }
    res.json(booking);
  } catch (err) {
    console.error("❌ booking by-ref error:", err);
    res.status(500).json({ message: "Failed to fetch booking by ref" });
  }
});

/* -------------------------------------------------------------------------- */
/*              GET /booking/user/:userId                                     */
/* -------------------------------------------------------------------------- */
router.get("/booking/user/:userId", async (req, res) => {
  console.log(`✅ (routes/bookingRoutes.js) GET /api/booking/booking/user/:userId called at`, new Date().toISOString(), {
    userId: req.params.userId,
  });
  try {
    const bookings = await Booking.find({ userId: req.params.userId }).sort({ createdAt: -1 });
    res.json(bookings);
  } catch (e) {
    console.error("❌ userBookings error:", e);
    res.status(500).json({ error: "Failed to fetch user bookings" });
  }
});

/* -------------------------------------------------------------------------- */
/*              POST /manual-create                                           */
/* -------------------------------------------------------------------------- */
router.post("/manual-create", (req, res, next) => {
  console.log(`✅ (routes/bookingRoutes.js) POST /api/booking/manual-create called at`, new Date().toISOString(), {
    user: req.user?.email || "unknown",
    bodyKeys: Object.keys(req.body || {}),
  });
  next();
}, verifyToken, manualCreateBooking);

/* -------------------------------------------------------------------------- */
/*              POST /mark-musician-paid                                      */
/* -------------------------------------------------------------------------- */
router.post("/mark-musician-paid", (req, res, next) => {
  console.log(`✅ (routes/bookingRoutes.js) POST /api/booking/mark-musician-paid called at`, new Date().toISOString(), {
    bodyKeys: Object.keys(req.body || {}),
  });
  next();
}, markMusicianAsPaid);

/* -------------------------------------------------------------------------- */
/*              GET /by-ref/:ref                                              */
/* -------------------------------------------------------------------------- */
router.get("/by-ref/:ref", (req, res, next) => {
  console.log(`✅ (routes/bookingRoutes.js) GET /api/booking/by-ref/:ref called at`, new Date().toISOString(), {
    ref: req.params.ref,
  });
  next();
}, getBookingByRef);

const getBookingDisplayName = (booking) => {
  const firstAct = Array.isArray(booking?.actsSummary)
    ? booking.actsSummary[0]
    : Array.isArray(booking?.items)
      ? booking.items[0]
      : null;

  return (
    firstAct?.actName ||
    firstAct?.name ||
    booking?.actName ||
    booking?.artistName ||
    "Band"
  );
};

const getBookingEventDate = (booking) => {
  const raw =
    booking?.eventDate ||
    booking?.date ||
    booking?.bookingDate ||
    booking?.eventDetails?.date ||
    booking?.answers?.event_date ||
    booking?.eventSheet?.answers?.event_date ||
    "";

  if (!raw) return "Date TBC";

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return String(raw);

  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

const getEventSheetUrl = (req, booking) => {
  const base =
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    process.env.PUBLIC_FRONTEND_URL ||
    "https://thesupremecollective.co.uk";

  const ref = booking?.bookingId || String(booking?._id || "");
  return `${String(base).replace(/\/$/, "")}/event-sheet/${ref}`;
};

const getEmailConfig = () => {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT || 465);
  const secure =
    process.env.SMTP_SECURE != null
      ? String(process.env.SMTP_SECURE).toLowerCase() === "true"
      : port === 465;

  const user =
    process.env.SMTP_USER ||
    process.env.EMAIL_USER ||
    process.env.GMAIL_USER ||
    process.env.MAIL_USER ||
    process.env.AGENT_EMAIL;

  const pass =
    process.env.SMTP_PASS ||
    process.env.EMAIL_PASS ||
    process.env.GMAIL_APP_PASSWORD ||
    process.env.GMAIL_PASS ||
    process.env.MAIL_PASS ||
    process.env.AGENT_PASSWORD;

  const fromAddress =
    process.env.SMTP_FROM_EMAIL ||
    process.env.EMAIL_FROM_ADDRESS ||
    process.env.EMAIL_USER ||
    process.env.GMAIL_USER ||
    user;

  const fromName =
    process.env.SMTP_FROM_NAME ||
    process.env.EMAIL_FROM_NAME ||
    "The Supreme Collective";

  const notifyTo =
    process.env.NOTIFY_BAND_EMAIL ||
    process.env.SMTP_FROM_EMAIL ||
    process.env.EMAIL_FROM_ADDRESS ||
    "hello@thesupremecollective.co.uk";

  if (!user || !pass) {
    throw new Error(
      "Missing email SMTP credentials. Set SMTP_USER and SMTP_PASS, or EMAIL_USER and EMAIL_PASS."
    );
  }

  return { host, port, secure, user, pass, fromAddress, fromName, notifyTo };
};

const createNotifyBandTransporter = () => {
  const { host, port, secure, user, pass } = getEmailConfig();

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
  });
};

/* -------------------------------------------------------------------------- */
/*              POST /notify-band                                             */
/* -------------------------------------------------------------------------- */

const humaniseEventSheetKey = (key = "") =>
  String(key || "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const formatEventSheetValueForPdf = (value) => {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === "object"
          ? Object.entries(item)
              .map(([k, v]) => `${humaniseEventSheetKey(k)}: ${formatEventSheetValueForPdf(v)}`)
              .join("; ")
          : formatEventSheetValueForPdf(item)
      )
      .join("\n");
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .map(([k, v]) => `${humaniseEventSheetKey(k)}: ${formatEventSheetValueForPdf(v)}`)
      .join("\n");
  }

  return String(value);
};

const buildEventSheetPdfBuffer = async (booking) => {
  const doc = new PDFDocument({ margin: 50, size: "A4" });
  const chunks = [];

  doc.on("data", (chunk) => chunks.push(chunk));

  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const bandName = getBookingDisplayName(booking);
  const eventDate = getBookingEventDate(booking);
  const ref = booking?.bookingId || String(booking?._id || "");
  const answers = booking?.eventSheet?.answers || {};

  doc.fontSize(22).text("Event Sheet", { align: "center" });
  doc.moveDown();
  doc.fontSize(12).text(`Booking ref: ${ref}`);
  doc.text(`Act: ${bandName}`);
  doc.text(`Event date: ${eventDate}`);
  doc.text(`Venue: ${booking?.venue || booking?.venueAddress || "—"}`);
  doc.moveDown();

  doc.fontSize(16).text("Event Details", { underline: true });
  doc.moveDown();

  Object.entries(answers)
    .filter(([key, value]) => {
      if (!key || value == null || value === "") return false;
      if (String(key).includes("screenshot_url")) return false;
      if (String(key).includes("base64")) return false;
      return true;
    })
    .forEach(([key, value]) => {
      if (doc.y > 730) doc.addPage();

      doc.fontSize(11).font("Helvetica-Bold").text(humaniseEventSheetKey(key));
      doc.font("Helvetica").text(formatEventSheetValueForPdf(value), {
        width: 500,
      });
      doc.moveDown(0.6);
    });

  doc.end();
  return done;
};

router.post("/notify-band", async (req, res) => {
  console.log(`✅ (routes/bookingRoutes.js) POST /api/booking/notify-band called at`, new Date().toISOString(), {
    bodyKeys: Object.keys(req.body || {}),
  });

  try {
    const { bookingId, bookingMongoId, bookingRef, eventSheet } = req.body || {};
    const lookupId = bookingMongoId || bookingId || bookingRef;

    if (!lookupId) {
      return res.status(400).json({
        success: false,
        message: "bookingId, bookingMongoId or bookingRef is required",
      });
    }

    const or = [];

    if (typeof bookingId === "string" && bookingId.trim()) {
      or.push({ bookingId: bookingId.trim() });
    }

    if (typeof bookingRef === "string" && bookingRef.trim()) {
      or.push({ bookingId: bookingRef.trim() });
    }

    if (
      typeof lookupId === "string" &&
      mongoose.Types.ObjectId.isValid(lookupId) &&
      String(new mongoose.Types.ObjectId(lookupId)) === lookupId
    ) {
      or.push({ _id: lookupId });
    }

    const booking = await Booking.findOne(or.length ? { $or: or } : { bookingId: lookupId });

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    if (eventSheet && (eventSheet.answers || eventSheet.complete)) {
      booking.eventSheet = {
        ...(booking.eventSheet || {}),
        answers: {
          ...(booking.eventSheet?.answers || {}),
          ...(eventSheet.answers || {}),
        },
        complete: {
          ...(booking.eventSheet?.complete || {}),
          ...(eventSheet.complete || {}),
        },
        submitted: true,
        updatedAt: new Date(),
      };
    } else {
      booking.eventSheet = {
        ...(booking.eventSheet || {}),
        submitted: true,
        updatedAt: new Date(),
      };
    }

    const emailConfig = getEmailConfig();
    const transporter = createNotifyBandTransporter();
    const bandName = getBookingDisplayName(booking);
    const eventDate = getBookingEventDate(booking);
    const eventSheetUrl = getEventSheetUrl(req, booking);
    const ref = booking.bookingId || String(booking._id);

    const subject = `Event sheet ready: ${bandName} — ${eventDate}`;

    const text = [
      `The event sheet has been submitted/updated for ${bandName}.`,
      ``,
      `Booking ref: ${ref}`,
      `Event date: ${eventDate}`,
      ``,
      `View the event sheet here:`,
      eventSheetUrl,
    ].join("\n");

    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #222;">
        <p>The event sheet has been submitted/updated for <strong>${bandName}</strong>.</p>
        <p>
          <strong>Booking ref:</strong> ${ref}<br />
          <strong>Event date:</strong> ${eventDate}
        </p>
        <p>
          <a href="${eventSheetUrl}" style="color: #ff6667; font-weight: bold;">
            View the event sheet
          </a>
        </p>
      </div>
    `;

    const pdfBuffer = await buildEventSheetPdfBuffer(booking);
const safeRef = String(ref || "event-sheet").replace(/[^a-z0-9-_]+/gi, "-");

const mailResult = await transporter.sendMail({
  from: `${emailConfig.fromName} <${emailConfig.fromAddress}>`,
  to: emailConfig.notifyTo,
  replyTo: emailConfig.fromAddress || "hello@thesupremecollective.co.uk",
  subject,
  text,
  html,
  attachments: [
    {
      filename: `event-sheet-${safeRef}.pdf`,
      content: pdfBuffer,
      contentType: "application/pdf",
    },
  ],
});

    await booking.save();

    console.log("✅ notify-band email sent", {
      bookingId: ref,
      to: emailConfig.notifyTo,
      from: emailConfig.fromAddress,
      smtpUser: emailConfig.user,
      messageId: mailResult?.messageId,
    });

    return res.json({
      success: true,
      message: "Band notification email sent",
      sentTo: emailConfig.notifyTo,
      messageId: mailResult?.messageId || null,
      booking,
    });
  } catch (err) {
    console.error("❌ notify-band error:", err);
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to notify band",
    });
  }
});

/* -------------------------------------------------------------------------- */
/*              POST /update-event-sheet                                      */
/* -------------------------------------------------------------------------- */
router.post("/update-event-sheet", (req, res, next) => {
  console.log(`✅ (routes/bookingRoutes.js) POST /api/booking/update-event-sheet called at`, new Date().toISOString(), {
    bodyKeys: Object.keys(req.body || {}),
  });
  next();
}, async (req, res) => {
  try {
    const { _id, bookingId, eventSheet } = req.body || {};
    if (!eventSheet)
      return res.status(400).json({ success: false, message: "Missing eventSheet" });

    let filter = null;
    const looksLikeObjectId = (v) =>
      typeof v === "string" &&
      mongoose.Types.ObjectId.isValid(v) &&
      String(new mongoose.Types.ObjectId(v)) === String(v);

    if (looksLikeObjectId(_id)) filter = { _id };
    else if (typeof bookingId === "string" && bookingId.trim())
      filter = { bookingId: bookingId.trim() };
    else return res.status(400).json({ success: false, message: "Provide _id or bookingId" });

    const doc = await Booking.findOneAndUpdate(
      filter,
      { $set: { eventSheet: { ...(eventSheet || {}), updatedAt: new Date() } } },
      { new: true }
    ).lean();

    if (!doc) return res.status(404).json({ success: false, message: "Booking not found" });
    return res.json({ success: true, bookingId: doc.bookingId });
  } catch (e) {
    console.error("❌ update-event-sheet error:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* -------------------------------------------------------------------------- */
/*              PUT /:bookingId/event-sheet                                   */
/* -------------------------------------------------------------------------- */
router.put("/:bookingId/event-sheet", (req, res, next) => {
  console.log(`✅ (routes/bookingRoutes.js) PUT /api/booking/:bookingId/event-sheet called at`, new Date().toISOString(), {
    bookingId: req.params.bookingId,
    bodyKeys: Object.keys(req.body || {}),
  });
  next();
}, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { answers = {}, complete = {} } = req.body || {};

    const doc = await Booking.findOneAndUpdate(
      { bookingId },
      {
        $set: {
          "eventSheet.answers": answers,
          "eventSheet.complete": complete,
          "eventSheet.updatedAt": new Date(),
        },
      },
      { new: true }
    ).lean();

    if (!doc) return res.status(404).json({ success: false, message: "Booking not found" });
    res.json({ success: true });
  } catch (e) {
    console.error("❌ event-sheet save error:", e);
    res.status(500).json({ success: false, message: e.message });
  }
});

export default router;