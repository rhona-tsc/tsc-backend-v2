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
    firstAct?.tscName ||
    firstAct?.act?.tscName ||
    booking?.act?.tscName ||
    booking?.tscName ||
    firstAct?.actName ||
    firstAct?.name ||
    firstAct?.title ||
    firstAct?.act?.name ||
    booking?.actName ||
    booking?.artistName ||
    booking?.act?.name ||
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
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const normalisePdfValue = (value) => {
  if (value == null || value === "") return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);

  if (Array.isArray(value)) {
    return value
      .map((item) => normalisePdfValue(item))
      .filter(Boolean)
      .join("\n");
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${humaniseEventSheetKey(k)}: ${normalisePdfValue(v)}`)
      .filter(Boolean)
      .join("\n");
  }

  return String(value).trim();
};

const getEventSheetAnswers = (booking) => booking?.eventSheet?.answers || {};

const pickAnswer = (answers, keys = []) => {
  for (const key of keys) {
    const value = answers?.[key];
    const formatted = normalisePdfValue(value);
    if (formatted) return formatted;
  }
  return "";
};

const pickBookingValue = (booking, keys = []) => {
  for (const key of keys) {
    const value = key.split(".").reduce((obj, part) => obj?.[part], booking);
    const formatted = normalisePdfValue(value);
    if (formatted) return formatted;
  }
  return "";
};

const getCoupleNamesForPdf = (answers, booking) => {
  const introducedAs = pickAnswer(answers, ["introduced_as", "introducedAs"]);
  if (introducedAs) return introducedAs;

  const partner1 = [
    pickAnswer(answers, ["partner1_first", "partner1First"]),
    pickAnswer(answers, ["partner1_last", "partner1Last"]),
  ].filter(Boolean).join(" ").trim();

  const partner2 = [
    pickAnswer(answers, ["partner2_first", "partner2First"]),
    pickAnswer(answers, ["partner2_last", "partner2Last"]),
  ].filter(Boolean).join(" ").trim();

  if (partner1 && partner2) return `${partner1} & ${partner2}`;
  if (partner1 || partner2) return partner1 || partner2;

  return pickBookingValue(booking, ["clientName", "customerName", "name"]) || "Event Sheet";
};

const getVenueForPdf = (answers, booking) =>
  pickAnswer(answers, ["venue", "venue_address", "venueAddress", "location", "event_location"]) ||
  pickBookingValue(booking, ["venue", "venueAddress", "eventDetails.venue", "eventDetails.location"]) ||
  "TBC";

const getEventDateForPdf = (answers, booking) => {
  const raw =
    pickAnswer(answers, ["event_date", "eventDate", "date"]) ||
    pickBookingValue(booking, ["eventDate", "date", "bookingDate", "eventDetails.date"]);

  if (!raw) return "TBC";

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;

  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

const getScheduleRowsForPdf = (answers) => {
  const rows = [];

  const simpleRows = Array.isArray(answers?.schedule_simple_rows)
    ? answers.schedule_simple_rows
    : Array.isArray(answers?.scheduleSimpleRows)
      ? answers.scheduleSimpleRows
      : [];

  const addRow = (activity, time, notes = "") => {
    const cleanActivity = normalisePdfValue(activity);
    const cleanTime = normalisePdfValue(time);
    const cleanNotes = normalisePdfValue(notes);

    if (cleanActivity || cleanTime || cleanNotes) {
      rows.push({
        activity: cleanActivity || "Schedule item",
        time: cleanTime || "TBC",
        notes: cleanNotes,
      });
    }
  };

  const customBandFinishRow = simpleRows.find((row) =>
    String(row?.label || row?.activity || row?.title || "")
      .trim()
      .toLowerCase() === "band finish"
  );

  addRow("Band arrival / load-in", answers?.schedule_simple_arrival || answers?.scheduleSimpleArrival);
  addRow("Setup", answers?.schedule_simple_setup || answers?.scheduleSimpleSetup);
  addRow("Soundcheck", answers?.schedule_simple_soundcheck || answers?.scheduleSimpleSoundcheck);
  addRow("Live set 1", answers?.schedule_simple_set1 || answers?.scheduleSimpleSet1);
  addRow("Intermission", answers?.schedule_simple_between1 || answers?.scheduleSimpleBetween1);
  addRow("Live set 2", answers?.schedule_simple_set2 || answers?.scheduleSimpleSet2);

  addRow(
    "Band finish",
    customBandFinishRow?.time ||
      customBandFinishRow?.value ||
      answers?.schedule_simple_band_finish ||
      answers?.scheduleSimpleBandFinish ||
      answers?.schedule_simple_finish_time ||
      answers?.scheduleSimpleFinishTime ||
      answers?.schedule_time_finish ||
      answers?.scheduleTimeFinish,
    customBandFinishRow?.notes || ""
  );

  simpleRows.forEach((row) => {
    const rawLabel = row?.label || row?.activity || row?.title;

    if (
      String(rawLabel || "").trim().toLowerCase() === "band finish"
    ) {
      return;
    }

    const label =
      String(rawLabel || "").trim().toLowerCase() === "pa provision for external dj"
        ? "PA provision finish"
        : rawLabel;

    const time = row?.time || row?.value;
    const notes = row?.notes;

    const duplicate = rows.some(
      (existing) =>
        String(existing.activity).trim().toLowerCase() ===
          String(label || "").trim().toLowerCase() &&
        String(existing.time).trim().toLowerCase() ===
          String(time || "").trim().toLowerCase()
    );

    if (!duplicate) addRow(label, time, notes);
  });

  return rows;
};

const splitLongText = (text = "") =>
  String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

const noInfo = "No information provided.";

const valueOrFallback = (value, fallback = noInfo) => {
  const formatted = normalisePdfValue(value);
  return formatted || fallback;
};

const yesNoNone = (value) => {
  const formatted = normalisePdfValue(value);
  if (!formatted) return noInfo;
  return formatted.toLowerCase() === "no" ? "None" : formatted;
};

const getFirstActSummary = (booking) => {
  if (Array.isArray(booking?.actsSummary) && booking.actsSummary[0]) return booking.actsSummary[0];
  if (Array.isArray(booking?.items) && booking.items[0]) return booking.items[0];
  return null;
};

const getLineupLabelForPdf = (booking) => {
  const firstAct = getFirstActSummary(booking);

  return (
    firstAct?.lineupLabel ||
    firstAct?.lineupName ||
    firstAct?.lineup?.actSize ||
    firstAct?.lineup?.lineupLabel ||
    firstAct?.actSize ||
    booking?.lineupLabel ||
    booking?.lineupName ||
    booking?.lineup?.actSize ||
    noInfo
  );
};

const getPromoLinksForPdf = (booking) => {
  const firstAct = getFirstActSummary(booking);

  const candidates = [
    firstAct?.videos,
    firstAct?.videoUrls,
    firstAct?.promoVideos,
    firstAct?.act?.videos,
    firstAct?.act?.videoUrls,
    firstAct?.act?.promoVideos,
    booking?.act?.videos,
    booking?.act?.videoUrls,
    booking?.act?.promoVideos,
  ];

  const urls = [];

  candidates.forEach((candidate) => {
    if (!candidate) return;
    const items = Array.isArray(candidate) ? candidate : [candidate];

    items.forEach((item) => {
      const url =
        typeof item === "string"
          ? item
          : item?.url || item?.link || item?.videoUrl;

      if (url && !urls.includes(url)) urls.push(url);
    });
  });

  return urls.join("\n");
};

const getChangingRoomForPdf = (answers) => {
  const value = pickAnswer(answers, ["changing_room", "changingRoom"]);
  const formatted = normalisePdfValue(value);

  if (!formatted) return noInfo;

  return formatted.toLowerCase() === "no"
    ? "No exclusive changing room"
    : formatted;
};

const getBookerPhoneForPdf = (answers, booking) =>
  pickAnswer(answers, ["booker_phone", "bookerPhone", "phone", "client_phone", "clientPhone"]) ||
  pickBookingValue(booking, ["userAddress.phone", "phone", "clientPhone", "customerPhone"]);

const getBookerEmailForPdf = (answers, booking) =>
  pickAnswer(answers, ["booker_email", "bookerEmail", "email", "client_email", "clientEmail"]) ||
  pickBookingValue(booking, ["userAddress.email", "userEmail", "email", "clientEmail", "customerEmail"]);

const getActImageUrlForPdf = (booking) => {
  const firstAct = getFirstActSummary(booking);
  const image = firstAct?.image || firstAct?.images?.[0] || booking?.act?.image || booking?.act?.images?.[0];
  if (typeof image === "string") return image;
  return image?.url || image?.secure_url || "";
};

const getHotMealsRequiredForPdf = (answers, booking) => {
  const explicit = pickAnswer(answers, ["hot_meals_required", "hotMealsRequired"]);
  if (explicit) return explicit;

  const firstAct = getFirstActSummary(booking);
  const candidates = [
    firstAct?.lineup?.hotMeal,
    firstAct?.hotMeal,
    booking?.lineup?.hotMeal,
    booking?.hotMeal,
  ];

  for (const value of candidates) {
    const formatted = normalisePdfValue(value);
    if (formatted) return formatted;
  }

  return noInfo;
};

const getPaidParkingSummaryForPdf = (answers) => {
  const totalCarsRaw = pickAnswer(answers, ["parking_num_cars", "parkingNumCars"]);
  const onsiteSpacesRaw = pickAnswer(answers, ["parking_spaces_on_site", "parkingSpacesOnSite"]);
  const costPerCarRaw = pickAnswer(answers, ["parking_cost_per_car", "parkingCostPerCar"]);

  const totalCars = Number.parseInt(totalCarsRaw, 10);
  const onsiteSpaces = Number.parseInt(onsiteSpacesRaw, 10);
  const paidSpaces = Number.isFinite(totalCars)
    ? Math.max(totalCars - (Number.isFinite(onsiteSpaces) ? onsiteSpaces : 0), 0)
    : null;

  if (paidSpaces == null) return noInfo;

  const costText = costPerCarRaw ? ` at £${costPerCarRaw} per car` : "";
  return `${paidSpaces} paid parking space${paidSpaces === 1 ? "" : "s"}${costText}`;
};

const fetchImageBufferForPdf = async (url) => {
  if (!url || typeof fetch !== "function") return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.warn("⚠️ Could not fetch event sheet image for PDF", {
      url,
      message: error?.message,
    });
    return null;
  }
};

const buildEventSheetPdfBuffer = async (booking) => {
  const doc = new PDFDocument({ margin: 42, size: "A4" });
  const chunks = [];

  doc.on("data", (chunk) => chunks.push(chunk));

  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const answers = getEventSheetAnswers(booking);
  const bandName = getBookingDisplayName(booking);
  const coupleNames = getCoupleNamesForPdf(answers, booking);
  const eventType = pickBookingValue(booking, ["eventType", "type", "eventDetails.type"]) || "Wedding";
  const eventDate = getEventDateForPdf(answers, booking);
  const venue = getVenueForPdf(answers, booking);
  const ref = booking?.bookingId || String(booking?._id || "");
  const lineupLabel = getLineupLabelForPdf(booking);
  const bookerPhone = getBookerPhoneForPdf(answers, booking);
  const actImageUrl = getActImageUrlForPdf(booking);
  const actImageBuffer = await fetchImageBufferForPdf(actImageUrl);

  const pageWidth = doc.page.width;
  const left = doc.page.margins.left;
  const contentWidth = pageWidth - doc.page.margins.left - doc.page.margins.right;
  const coral = "#ff6667";
  const dark = "#111827";
  const grey = "#4b5563";
  const pale = "#f6f7f9";
  const border = "#d1d5db";

  const ensureSpace = (height = 80) => {
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
  };

  const sectionTitle = (title) => {
    ensureSpace(45);
    doc.moveDown(0.7);
    doc.font("Helvetica-Bold").fontSize(14).fillColor(dark).text(String(title).toUpperCase(), left, doc.y);
    doc
      .moveTo(left, doc.y + 4)
      .lineTo(left + contentWidth, doc.y + 4)
      .strokeColor(coral)
      .lineWidth(1)
      .stroke();
    doc.moveDown(0.8);
  };

  const labelValue = (label, value, options = {}) => {
    const formatted = options.allowBlank ? valueOrFallback(value) : normalisePdfValue(value);
    if (!formatted && !options.showFallback) return;

    ensureSpace(options.large ? 95 : 45);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(grey).text(String(label).toUpperCase(), left, doc.y);
    doc.moveDown(0.15);
    doc.font("Helvetica").fontSize(11).fillColor(dark).text(formatted || noInfo, left, doc.y, {
      width: contentWidth,
      lineGap: 2,
    });
    doc.moveDown(0.55);
  };

  const boxedNote = (title, value, options = {}) => {
    const formatted = options.allowBlank ? valueOrFallback(value) : normalisePdfValue(value);
    if (!formatted && !options.showFallback) return;

    const text = formatted || noInfo;
    ensureSpace(90);
    const startY = doc.y;
    const estimatedHeight = Math.max(48, doc.heightOfString(text, { width: contentWidth - 24 }) + 34);
    doc.roundedRect(left, startY, contentWidth, estimatedHeight, 6).fillAndStroke(pale, border);
    doc.fillColor(dark).font("Helvetica-Bold").fontSize(10).text(title, left + 12, startY + 10, {
      width: contentWidth - 24,
    });
    doc.font("Helvetica").fontSize(10).text(text, left + 12, doc.y + 4, {
      width: contentWidth - 24,
      lineGap: 2,
    });
    doc.y = startY + estimatedHeight + 10;
  };

  const drawTable = (headers, rows, widths) => {
    if (!rows.length) return;

    ensureSpace(80);
    const rowHeight = 24;
    const headerY = doc.y;
    let x = left;

    doc.rect(left, headerY, contentWidth, rowHeight).fill("#111827");
    headers.forEach((header, index) => {
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff").text(header, x + 6, headerY + 7, {
        width: widths[index] - 12,
      });
      x += widths[index];
    });
    doc.y = headerY + rowHeight;

    rows.forEach((row, rowIndex) => {
      const values = Array.isArray(row) ? row : Object.values(row);
      const heights = values.map((value, index) =>
        doc.heightOfString(normalisePdfValue(value) || " ", { width: widths[index] - 12 }) + 14,
      );
      const height = Math.max(24, ...heights);
      ensureSpace(height + 12);

      const y = doc.y;
      doc.rect(left, y, contentWidth, height).fill(rowIndex % 2 === 0 ? "#ffffff" : pale);
      doc.rect(left, y, contentWidth, height).strokeColor(border).lineWidth(0.5).stroke();

      x = left;
      values.forEach((value, index) => {
        doc.font("Helvetica").fontSize(9).fillColor(dark).text(normalisePdfValue(value) || "—", x + 6, y + 7, {
          width: widths[index] - 12,
          lineGap: 1,
        });
        x += widths[index];
      });
      doc.y = y + height;
    });
    doc.moveDown(0.7);
  };

  // Header
  doc.font("Helvetica-Bold").fontSize(22).fillColor(dark).text(`${coupleNames}'s ${eventType}`, {
    align: "center",
  });
  doc.moveDown(0.35);
  doc.font("Helvetica-Bold").fontSize(12).fillColor(coral).text(bandName, { align: "center" });
  doc.moveDown(1.1);

  if (actImageBuffer) {
    try {
      ensureSpace(150);
      const imageWidth = Math.min(contentWidth, 360);
      const imageX = left + (contentWidth - imageWidth) / 2;
      doc.image(actImageBuffer, imageX, doc.y, {
        fit: [imageWidth, 135],
        align: "center",
        valign: "center",
      });
      doc.y += 150;
    } catch (error) {
      console.warn("⚠️ Could not add event sheet image to PDF", { message: error?.message });
    }
  }

  // At-a-glance summary
  doc.roundedRect(left, doc.y, contentWidth, 108, 8).fillAndStroke(pale, border);
  const summaryY = doc.y + 14;
  const col = contentWidth / 3;
  const summaryItems = [
    ["Date", eventDate],
    ["Act", bandName],
    ["Lineup", lineupLabel],
    ["Bookers", coupleNames],
    ["Phone", bookerPhone || noInfo],
    ["Booking ref", ref],
  ];
  summaryItems.forEach(([label, value], index) => {
    const row = Math.floor(index / 3);
    const column = index % 3;
    const x = left + col * column + 12;
    const y = summaryY + row * 46;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(grey).text(label.toUpperCase(), x, y, { width: col - 24 });
    doc.font("Helvetica-Bold").fontSize(11).fillColor(dark).text(value || noInfo, x, y + 15, { width: col - 24 });
  });
  doc.y += 126;

  sectionTitle("Event overview");
  labelValue("Event type", eventType, { showFallback: true });
  labelValue("Band name", bandName, { showFallback: true });
  labelValue("Lineup size", lineupLabel, { showFallback: true });
  labelValue("Bookers", coupleNames, { showFallback: true });
  labelValue("Booker phone", bookerPhone, { showFallback: true });
  labelValue("Venue address", venue, { showFallback: true });
  labelValue("Venue pin", pickAnswer(answers, ["venue_pin", "venuePin"]), { showFallback: true });
  labelValue("Load-in pin", pickAnswer(answers, ["load_in_pin", "loadInPin"]), { showFallback: true });
  labelValue("Performance room / area", [
    pickAnswer(answers, ["performance_room", "performanceRoom"]),
    pickAnswer(answers, ["performance_area", "performanceArea"]),
  ].filter(Boolean).join(" - "), { showFallback: true });
  labelValue("Guest count", pickAnswer(answers, ["guest_count", "guestCount"]), { showFallback: true });
  labelValue("Attire", pickAnswer(answers, ["attire_notes", "attireNotes", "attire"]), { showFallback: true });
labelValue("Promo video reference", getPromoLinksForPdf(booking), { showFallback: true });
  sectionTitle("Schedule");
  drawTable(["Activity", "Time", "Notes"], getScheduleRowsForPdf(answers).map((row) => [row.activity, row.time, row.notes || noInfo]), [220, 120, contentWidth - 340]);

  sectionTitle("Parking & load-in");
  labelValue("Parking availability", pickAnswer(answers, ["parking_available", "parkingAvailable"]), { showFallback: true });
  labelValue("Total parking required", pickAnswer(answers, ["parking_num_cars", "parkingNumCars"]), { showFallback: true });
  labelValue("On-site spaces", pickAnswer(answers, ["parking_spaces_on_site", "parkingSpacesOnSite"]), { showFallback: true });
  labelValue("Paid parking required", getPaidParkingSummaryForPdf(answers), { showFallback: true });
  labelValue("Parking location / address", pickAnswer(answers, ["parking_address", "parkingAddress", "parking_location", "parkingLocation"]), { showFallback: true });
  labelValue("Parking cost per car", pickAnswer(answers, ["parking_cost_per_car", "parkingCostPerCar"]), { showFallback: true });
  boxedNote("Load-in instructions", pickAnswer(answers, ["load_in_instructions", "loadInInstructions", "special_directions", "specialDirections"]), { showFallback: true });

  sectionTitle("Production notes");
  labelValue("Outdoor performance", yesNoNone(pickAnswer(answers, ["outdoor_performance", "outdoorPerformance"])), { showFallback: true });
  labelValue("In-house PA", yesNoNone(pickAnswer(answers, ["use_inhouse_pa", "useInhousePa"])), { showFallback: true });
  labelValue("In-house lights", yesNoNone(pickAnswer(answers, ["use_inhouse_lights", "useInhouseLights"])), { showFallback: true });
  labelValue("Sound limits", yesNoNone(pickAnswer(answers, ["sound_limits_present", "soundLimitsPresent"])), { showFallback: true });
  labelValue("Hard close time", pickAnswer(answers, ["hard_close_time", "hardCloseTime"]), { showFallback: true });
  boxedNote("Production / venue notes", pickAnswer(answers, ["production_notes", "pa_notes", "sound_limit_notes", "notes_for_band", "notesForBand"]), { showFallback: true });

  sectionTitle("Food & refreshments");
  labelValue("Hot meals required", getHotMealsRequiredForPdf(answers, booking), { showFallback: true });
  labelValue("Meal timing / catering notes", pickAnswer(answers, ["meal_time", "mealTime", "food_notes", "foodNotes", "catering_notes", "cateringNotes"]), { showFallback: true });
labelValue("Changing room", getChangingRoomForPdf(answers), { showFallback: true });
  boxedNote("Changing room notes", pickAnswer(answers, ["changing_room_notes", "changingRoomNotes"]), { showFallback: true });

  sectionTitle("Contacts");
  const contacts = pickAnswer(answers, ["contacts_personal", "contactsPersonal", "contacts", "point_of_contact", "pointOfContact"]);
  boxedNote("Point of contact", contacts, { showFallback: true });

  sectionTitle("Music");
  labelValue("First dance", pickAnswer(answers, ["first_dance_song", "firstDanceSong"]), { showFallback: true });
  labelValue("First dance performed by", pickAnswer(answers, ["first_dance_performed_by", "firstDancePerformedBy"]), { showFallback: true });
  const songSuggestions = pickAnswer(answers, ["song_suggestions", "songSuggestions"]);
  const songs = splitLongText(songSuggestions);
  if (songs.length) {
    ensureSpace(80);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(grey).text("SONG SUGGESTIONS", left, doc.y);
    doc.moveDown(0.35);
    songs.forEach((song) => {
      ensureSpace(18);
      doc.font("Helvetica").fontSize(9.5).fillColor(dark).text(`• ${song}`, left + 8, doc.y, {
        width: contentWidth - 8,
        lineGap: 1,
      });
    });
    doc.moveDown(0.8);
  } else {
    labelValue("Song suggestions", noInfo, { showFallback: true });
  }
  boxedNote("Spotify playlist / DJ notes", pickAnswer(answers, ["spotify_playlist", "spotifyPlaylist", "spotify_playlist_url", "spotifyPlaylistUrl", "playlist_url", "playlistUrl", "dj_requests", "djRequests", "playlist_notes", "playlistNotes"]), { showFallback: true });

  sectionTitle("Socials, suppliers & notes");
  boxedNote("Socials", pickAnswer(answers, ["socials", "social_handles", "socialHandles"]), { showFallback: true });
  boxedNote("Other suppliers", pickAnswer(answers, ["other_suppliers", "otherSuppliers", "suppliers"]), { showFallback: true });
  boxedNote("Additional notes", pickAnswer(answers, ["notes", "additional_notes", "additionalNotes"]), { showFallback: true });

  const excludedKeys = new Set([
    "parking_num_cars", "parkingNumCars", "schedule_simple_arrival", "scheduleSimpleArrival",
    "schedule_simple_start", "scheduleSimpleStart", "schedule_simple_finish_time", "scheduleSimpleFinishTime",
    "schedule_simple_finish_dayOffset", "scheduleSimpleFinishDayOffset", "schedule_simple_rows", "scheduleSimpleRows",
    "schedule_time_finish", "scheduleTimeFinish", "schedule_dayOffset_finish", "scheduleDayOffsetFinish",
    "schedule_simple_set1", "scheduleSimpleSet1", "schedule_simple_set2", "scheduleSimpleSet2",
    "schedule_simple_between1", "scheduleSimpleBetween1", "schedule_simple_setup", "scheduleSimpleSetup",
    "schedule_simple_soundcheck", "scheduleSimpleSoundcheck", "song_suggestions", "songSuggestions",
    "parking_available", "parkingAvailable", "load_in_instructions", "loadInInstructions",
    "parking_screenshot_name", "parkingScreenshotName", "parking_checkout_status", "parkingCheckoutStatus",
    "parking_cost_per_car", "parkingCostPerCar", "parking_spaces_on_site", "parkingSpacesOnSite",
    "parking_address", "parkingAddress", "parking_location", "parkingLocation",
    "partner1_first", "partner1First", "partner1_last", "partner1Last", "partner2_first", "partner2First",
"partner2_last", "partner2Last", "introduced_as", "introducedAs", "attire_notes", "attireNotes", "attire",
    "venue_pin", "venuePin", "load_in_pin", "loadInPin", "performance_room", "performanceRoom",
    "guest_count", "guestCount", "outdoor_performance", "outdoorPerformance", "performance_area", "performanceArea",
    "use_inhouse_pa", "useInhousePa", "use_inhouse_lights", "useInhouseLights", "sound_limits_present", "soundLimitsPresent",
    "hard_close_time", "hardCloseTime", "first_dance_song", "firstDanceSong", "first_dance_performed_by", "firstDancePerformedBy",
    "changing_room", "changingRoom", "changing_room_notes", "changingRoomNotes", "contacts_personal", "contactsPersonal",
    "notes", "additional_notes", "additionalNotes", "socials", "social_handles", "socialHandles",
    "other_suppliers", "otherSuppliers", "suppliers", "spotify_playlist", "spotifyPlaylist", "spotify_playlist_url", "spotifyPlaylistUrl",
    "playlist_url", "playlistUrl", "dj_requests", "djRequests", "playlist_notes", "playlistNotes", "meal_time", "mealTime",
    "food_notes", "foodNotes", "catering_notes", "cateringNotes", "hot_meals_required", "hotMealsRequired",
"booker_phone", "bookerPhone", "phone", "client_phone", "clientPhone", "booker_email", "bookerEmail", "email", "client_email", "clientEmail", "userEmail",  ]);

  const otherEntries = Object.entries(answers).filter(([key, value]) => {
    if (!key || excludedKeys.has(key)) return false;
    if (value == null || value === "") return false;
    if (String(key).toLowerCase().includes("base64")) return false;
    if (String(key).toLowerCase().includes("screenshot_url")) return false;
    return true;
  });

  if (otherEntries.length) {
    sectionTitle("Other submitted details");
    otherEntries.forEach(([key, value]) => labelValue(humaniseEventSheetKey(key), value, { large: true }));
  }

  doc.moveDown(1);
  ensureSpace(30);
  doc.fontSize(8).fillColor(grey).text(
    `Generated by The Supreme Collective on ${new Date().toLocaleString("en-GB")}`,
    { align: "center" },
  );

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