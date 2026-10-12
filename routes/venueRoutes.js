import express from "express";
import Venue from "../models/venueModel.js";
import Booking from "../models/bookingModel.js";
import authUser from "../middleware/auth.js";
import multer from "multer";
import { parseVenueEventSheet } from "../services/venueEventSheetParser.js";

const router = express.Router();
const clean = (v) => String(v ?? "").trim();
const first = (...values) => values.map(clean).find(Boolean) || "";
const valueFrom = (obj, keys) => first(...keys.map((key) => obj?.[key]));
const postcodeFrom = (value) => (clean(value).toUpperCase().match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/) || [""])[0].replace(/\s+/g, " ");
const normaliseKey = (name, address) => {
  const pc = postcodeFrom(address);
  const base = pc || `${clean(name)} ${clean(address)}`;
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
};
const uniqueStrings = (values) => [...new Set((values || []).map(clean).filter(Boolean))];
const eventSheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 50, fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => callback(null, file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || file.originalname.toLowerCase().endsWith(".docx")),
});

function extractAct(booking) {
  const candidates = [booking?.items?.[0], booking?.acts?.[0], booking?.lineup, booking?.bookingDetails];
  for (const item of candidates) {
    if (!item) continue;
    const actName = first(item.actName, item.name, item.title, item?.act?.name, item?.act?.tscName);
    if (actName) return { actName, actId: first(item.actId, item?._id, item?.act?._id) };
  }
  return { actName: "", actId: "" };
}

function extractedVenue(booking) {
  const answers = booking?.eventSheet?.answers || {};
  const complete = booking?.eventSheet?.complete || {};
  const name = first(
    valueFrom(answers, ["venue_name", "venueName"]),
    valueFrom(complete, ["venue_name", "venueName"]),
    booking?.venue,
    booking?.bookingDetails?.venue,
  );
  const address = first(
    valueFrom(answers, ["venue_address", "venueAddress", "location", "address"]),
    booking?.venueAddress,
    booking?.address,
    name,
  );
  const roomName = first(
    valueFrom(answers, ["venue_room", "room_name", "performance_room", "room"]),
    valueFrom(complete, ["venue_room", "room_name", "performance_room", "room"]),
    "Main / unspecified room",
  );
  const pin = valueFrom(answers, ["venue_pin", "venuePin", "google_maps_pin", "location_pin"]);
  const { actName, actId } = extractAct(booking);
  return {
    name: name || address,
    address,
    postcode: postcodeFrom(address),
    county: valueFrom(answers, ["venue_county", "county"]),
    googleMapsUrl: /google\.(com|co\.uk)\/maps/i.test(pin) ? pin : "",
    what3wordsUrl: /what3words|w3w\.co/i.test(pin) ? pin : "",
    loadingPinUrl: pin,
    parking: valueFrom(answers, ["parking", "parking_details", "venue_parking", "parking_notes"]),
    parkingPinUrl: valueFrom(answers, ["parking_pin", "parkingPin"]),
    generalDirections: valueFrom(answers, ["special_directions", "directions", "loading_directions", "access_notes"]),
    supplierRequirements: valueFrom(answers, ["supplier_requirements", "supplier_forms", "venue_supplier_forms"]),
    room: {
      name: roomName,
      performanceArea: valueFrom(answers, ["room_area", "performance_area", "room_and_area", "venue_room_notes"]),
      accessAndLoading: valueFrom(answers, ["special_directions", "loading_directions", "access_notes"]),
      changingRoom: valueFrom(answers, ["changing_room", "green_room", "changingRoom"]),
      soundLimitations: valueFrom(answers, ["sound_limitations", "sound_restrictions", "sound_limiter"]),
      soundLimiterDb: valueFrom(answers, ["sound_limiter_db", "db_limit"]),
      curfewAndCloseTime: valueFrom(answers, ["venue_close_time", "curfew", "close_time"]),
      paAndLighting: valueFrom(answers, ["pa_system_lights", "pa_and_lighting", "pa_lighting"]),
      capacity: valueFrom(answers, ["room_size_guests", "guest_count", "capacity"]),
    },
    visit: {
      bookingId: booking?.bookingId || String(booking?._id || ""),
      eventDate: booking?.eventDate || booking?.date,
      actId,
      actName,
      roomName,
      clientName: first(booking?.clientName, answers.client_names),
      sourceUrl: booking?.eventSheetLink || "",
    },
  };
}

async function mergeBooking(booking) {
  const data = extractedVenue(booking);
  if (!data.name) return { skipped: true };
  const key = normaliseKey(data.name, data.address);
  if (!key) return { skipped: true };
  let venue = await Venue.findOne({ normalizedKey: key });
  if (!venue) venue = new Venue({ name: data.name, normalizedKey: key, rooms: [] });
  venue.name ||= data.name;
  venue.address ||= data.address;
  venue.postcode ||= data.postcode;
  venue.county ||= data.county;
  venue.googleMapsUrl ||= data.googleMapsUrl;
  venue.what3wordsUrl ||= data.what3wordsUrl;
  venue.loadingPinUrl ||= data.loadingPinUrl;
  venue.parking ||= data.parking;
  venue.parkingPinUrl ||= data.parkingPinUrl;
  venue.generalDirections ||= data.generalDirections;
  venue.supplierRequirements ||= data.supplierRequirements;
  if (data.name !== venue.name) venue.aliases = uniqueStrings([...(venue.aliases || []), data.name]);
  const source = { kind: "booking", sourceId: data.visit.bookingId, title: data.visit.clientName, url: data.visit.sourceUrl, eventDate: data.visit.eventDate };
  if (!venue.sources.some((s) => s.kind === source.kind && s.sourceId === source.sourceId)) venue.sources.push(source);
  if (!venue.visits.some((v) => v.bookingId === data.visit.bookingId)) venue.visits.push(data.visit);
  let room = venue.rooms.find((r) => clean(r.name).toLowerCase() === clean(data.room.name).toLowerCase());
  if (!room) { venue.rooms.push({ ...data.room, sources: [source] }); room = venue.rooms[venue.rooms.length - 1]; }
  else {
    for (const field of ["performanceArea", "accessAndLoading", "changingRoom", "soundLimitations", "soundLimiterDb", "curfewAndCloseTime", "paAndLighting", "capacity"]) room[field] ||= data.room[field];
    if (!room.sources.some((s) => s.kind === source.kind && s.sourceId === source.sourceId)) room.sources.push(source);
  }
  await venue.save();
  return { venue, skipped: false };
}

const publicVenue = (venue) => ({
  _id: venue._id,
  name: venue.name,
  address: venue.address,
  postcode: venue.postcode,
  county: venue.county,
  website: venue.website,
  googleMapsUrl: venue.googleMapsUrl,
  what3wordsUrl: venue.what3wordsUrl,
  loadingPinUrl: venue.loadingPinUrl,
  parking: venue.parking,
  parkingPinUrl: venue.parkingPinUrl,
  generalDirections: venue.generalDirections,
  rooms: (venue.rooms || []).map((room) => ({
    _id: room._id,
    name: room.name,
    performanceArea: room.performanceArea,
    accessAndLoading: room.accessAndLoading,
    changingRoom: room.changingRoom,
    soundLimitations: room.soundLimitations,
    soundLimiterDb: room.soundLimiterDb,
    curfewAndCloseTime: room.curfewAndCloseTime,
    paAndLighting: room.paAndLighting,
    powerAndStage: room.powerAndStage,
    capacity: room.capacity,
  })),
  actsPerformed: uniqueStrings((venue.visits || []).map((visit) => visit.actName)),
  lastVerifiedAt: venue.lastVerifiedAt,
  reviewStatus: venue.reviewStatus,
  updatedAt: venue.updatedAt,
});

router.get("/public", async (req, res) => {
  try {
    const q = clean(req.query.q);
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const filter = q ? { $or: ["name", "aliases", "address", "postcode", "county", "rooms.name"].map((field) => ({ [field]: { $regex: escaped, $options: "i" } })) } : {};
    const venues = await Venue.find(filter).sort({ name: 1 }).lean();
    res.json({ success: true, venues: venues.map(publicVenue) });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

router.get("/public/:id", async (req, res) => {
  try {
    const venue = await Venue.findById(req.params.id).lean();
    if (!venue) return res.status(404).json({ success: false, message: "Venue not found" });
    res.json({ success: true, venue: publicVenue(venue) });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

router.use(authUser);

router.post("/imports/event-sheets/preview", eventSheetUpload.array("eventSheets", 50), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ success: false, message: "Choose at least one Word event sheet" });
    const parsed = await Promise.all(req.files.map(parseVenueEventSheet));
    const previews = [];
    for (const item of parsed) {
      const venue = item.venue;
      const key = normaliseKey(venue.name, venue.address);
      const possibleMatch = await Venue.findOne({ $or: [{ normalizedKey: key }, ...(venue.postcode ? [{ postcode: venue.postcode }] : [])] }).select("_id name address postcode rooms.name").lean();
      previews.push({ ...item, possibleMatch: possibleMatch || null });
    }
    res.json({ success: true, previews });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

router.post("/imports/event-sheets/confirm", async (req, res) => {
  try {
    const imports = Array.isArray(req.body?.imports) ? req.body.imports : [];
    if (!imports.length) return res.status(400).json({ success: false, message: "There are no reviewed venues to import" });
    const results = [];
    for (const item of imports) {
      const incoming = item?.venue || item;
      if (!clean(incoming?.name)) { results.push({ fileName: item?.fileName, status: "skipped", message: "Venue name is missing" }); continue; }
      const key = normaliseKey(incoming.name, incoming.address);
      let venue = item?.matchVenueId ? await Venue.findById(item.matchVenueId) : await Venue.findOne({ normalizedKey: key });
      const created = !venue;
      if (!venue) venue = new Venue({ name: incoming.name, normalizedKey: key, rooms: [] });
      for (const field of ["name", "address", "postcode", "county", "website", "googleMapsUrl", "what3wordsUrl", "loadingPinUrl", "parking", "parkingPinUrl", "generalDirections"]) {
        if (!clean(venue[field]) && clean(incoming[field])) venue[field] = incoming[field];
      }
      const source = incoming.source || { kind: "event_sheet", sourceId: item.fileName, title: item.fileName };
      if (!venue.sources.some((entry) => entry.kind === source.kind && entry.sourceId === source.sourceId)) venue.sources.push(source);
      if (incoming.visit && !venue.visits.some((entry) => entry.bookingId === incoming.visit.bookingId)) venue.visits.push(incoming.visit);
      for (const incomingRoom of incoming.rooms || []) {
        let room = venue.rooms.find((entry) => clean(entry.name).toLowerCase() === clean(incomingRoom.name).toLowerCase());
        if (!room) { venue.rooms.push({ ...incomingRoom, sources: [source] }); continue; }
        for (const field of ["performanceArea", "accessAndLoading", "changingRoom", "soundLimitations", "soundLimiterDb", "curfewAndCloseTime", "paAndLighting", "powerAndStage", "capacity"]) {
          if (!clean(room[field]) && clean(incomingRoom[field])) room[field] = incomingRoom[field];
        }
        if (!room.sources.some((entry) => entry.kind === source.kind && entry.sourceId === source.sourceId)) room.sources.push(source);
      }
      venue.reviewStatus = "review_needed";
      await venue.save();
      results.push({ fileName: item.fileName, status: created ? "created" : "merged", venueId: venue._id, venueName: venue.name });
    }
    res.json({ success: true, results });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

router.get("/", async (req, res) => {
  try {
    const q = clean(req.query.q);
    const filter = q ? { $or: ["name", "aliases", "address", "postcode", "rooms.name", "visits.actName"].map((field) => ({ [field]: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } })) } : {};
    const venues = await Venue.find(filter).sort({ name: 1 }).lean();
    res.json({ success: true, venues });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

router.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    const normalizedKey = normaliseKey(body.name, body.address);
    if (!body.name || !normalizedKey) return res.status(400).json({ success: false, message: "Venue name is required" });
    const venue = await Venue.create({ ...body, normalizedKey });
    res.status(201).json({ success: true, venue });
  } catch (error) { res.status(error?.code === 11000 ? 409 : 500).json({ success: false, message: error.message }); }
});

router.put("/:id", async (req, res) => {
  try {
    const update = { ...(req.body || {}) };
    delete update._id;
    if (update.name || update.address) {
      const current = await Venue.findById(req.params.id);
      update.normalizedKey = normaliseKey(update.name || current?.name, update.address || current?.address);
    }
    const venue = await Venue.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!venue) return res.status(404).json({ success: false, message: "Venue not found" });
    res.json({ success: true, venue });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

router.post("/:id/feedback", async (req, res) => {
  try {
    const note = clean(req.body?.note);
    if (!note) return res.status(400).json({ success: false, message: "Feedback note is required" });
    const venue = await Venue.findByIdAndUpdate(req.params.id, { $push: { feedback: { ...req.body, note } } }, { new: true });
    res.json({ success: true, venue });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

router.post("/sync/bookings", async (_req, res) => {
  try {
    const bookings = await Booking.find({ $or: [{ venue: { $exists: true, $ne: "" } }, { venueAddress: { $exists: true, $ne: "" } }, { "eventSheet.answers": { $exists: true } }] }).lean();
    let imported = 0; let skipped = 0;
    for (const booking of bookings) { const result = await mergeBooking(booking); result.skipped ? skipped++ : imported++; }
    res.json({ success: true, imported, skipped, total: bookings.length });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

export { mergeBooking };
export default router;
