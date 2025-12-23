// musicianController.js

import validator from "validator";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import musicianModel from "../models/musicianModel.js";
import actModel from "../models/actModel.js";
import nodemailer from "nodemailer";
import connectCloudinary from "../config/cloudinary.js";
import { uploader } from "../utils/cloudinary.js";
import puppeteer from "puppeteer";
import mongoose from "mongoose";
import Song from "../models/songModel.js";
import { postcodes as POSTCODE_MAP_ARR } from "../utils/postcodes.js";

const POSTCODE_MAP =
  (Array.isArray(POSTCODE_MAP_ARR) && POSTCODE_MAP_ARR[0]) || {};

// ----------------------- Utilities -----------------------

const safeJSONParse = (data, fallback = undefined) => {
  try {
    return data ? JSON.parse(data) : fallback;
  } catch (error) {
    console.error("Invalid JSON received:", data);
    return fallback;
  }
};

const sanitizeFileName = (name) =>
  name
    .replace(/[^\w.-]/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase();

const uploadToCloudinary = (buffer, originalname, resourceType = "image") =>
  new Promise((resolve, reject) => {
    const safeName = sanitizeFileName(originalname);
    console.log(`Uploading ${safeName} to Cloudinary...`);

    const uploadStream = connectCloudinary.uploader.upload_stream(
      { resource_type: resourceType, public_id: safeName },
      (error, result) => {
        if (error) {
          console.error(`Cloudinary upload failed for ${safeName}:`, error);
          reject(new Error("Cloudinary upload failed"));
        } else {
          console.log(`✅ Successfully uploaded ${safeName}`);
          resolve(result);
        }
      }
    );

    uploadStream.end(buffer);
  });

// Merge helpers
const mergeObjectIdsUnique = (existingIds = [], incomingIds = []) => {
  const a = existingIds.map(String);
  const b = incomingIds.map(String);
  return Array.from(new Set([...a, ...b]));
};

const selectedSongKey = (s) =>
  `${(s?.title || "").trim().toLowerCase()}|${(s?.artist || "")
    .trim()
    .toLowerCase()}|${s?.year ?? ""}`;

const mergeSelectedSongsUnique = (existing = [], incoming = []) => {
  const out = Array.isArray(existing) ? [...existing] : [];
  const seen = new Set(out.map(selectedSongKey));
  for (const s of Array.isArray(incoming) ? incoming : []) {
    const k = selectedSongKey(s);
    if (!seen.has(k)) {
      seen.add(k);
      out.push({
        title: s?.title || "",
        artist: s?.artist || "",
        genre: s?.genre || "",
        year: s?.year || "",
      });
    }
  }
  return out;
};

// De-dupe repertoire objects by title|artist|year and normalize shape
const repKey = (s) =>
  `${(s?.title || "").trim().toLowerCase()}|${(s?.artist || "")
    .trim()
    .toLowerCase()}|${s?.year ?? ""}`;

const normalizeRep = (s) => ({
  title: (s?.title || "").toString().trim(),
  artist: (s?.artist || "").toString().trim(),
  // keep year as number when possible, fallback to empty string
  year:
    s?.year === "" || s?.year == null || Number.isNaN(Number(s?.year))
      ? ""
      : Number(s.year),
  genre: (s?.genre || "").toString().trim(),
});

const mergeRepertoireObjectsUnique = (existing = [], incoming = []) => {
  const out = Array.isArray(existing) ? existing.map(normalizeRep) : [];
  const seen = new Set(out.map(repKey));
  for (const s of Array.isArray(incoming) ? incoming : []) {
    const n = normalizeRep(s);
    const k = repKey(n);
    if (!seen.has(k) && n.title && n.artist) {
      seen.add(k);
      out.push(n);
    }
  }
  return out;
};

// --- Retry save on VersionError (optimistic concurrency) ---
const saveDeputyWithRetry = async ({ staleDoc, parsedData }) => {
  try {
    return await staleDoc.save();
  } catch (e) {
    if (e?.name !== "VersionError") throw e;

    console.warn("🔁 VersionError: refetching deputy and retrying save");

    // Get a fresh copy
    const fresh = await musicianModel.findById(staleDoc._id);
    if (!fresh) throw e;

    // IMPORTANT: re-merge arrays that we protect (we already deleted them from parsedData above)
    // Repertoire (array of song objects)
    if (Array.isArray(staleDoc.repertoire)) {
      fresh.repertoire = mergeRepertoireObjectsUnique(
        fresh.repertoire || [],
        staleDoc.repertoire || []
      );
      fresh.markModified("repertoire");
    }

    // Selected songs (array of song objects)
    if (Array.isArray(staleDoc.selectedSongs)) {
      fresh.selectedSongs = mergeSelectedSongsUnique(
        fresh.selectedSongs || [],
        staleDoc.selectedSongs || []
      );
      fresh.markModified("selectedSongs");
    }

    // Apply all remaining parsed fields (repertoire/selectedSongs were already handled & removed)
    Object.assign(fresh, parsedData);

    return await fresh.save();
  }
};

/* -------------------- helpers -------------------- */

// --- Location helpers ---------------------------------------------

// A small adjacency map (expand as needed)
// All keys and values MUST be lowercased.
const COUNTY_NEIGHBORS = {
  // ---------------- ENGLAND ----------------
  bedfordshire: [
    "buckinghamshire",
    "hertfordshire",
    "cambridgeshire",
    "northamptonshire",
  ],
  berkshire: [
    "oxfordshire",
    "hampshire",
    "surrey",
    "greater london",
    "buckinghamshire",
    "wiltshire",
  ],
  bristol: ["gloucestershire", "somerset", "wilts", "wiltshire"], // “wilts” for tolerance
  buckinghamshire: [
    "oxfordshire",
    "northamptonshire",
    "bedfordshire",
    "hertfordshire",
    "greater london",
    "berkshire",
  ],
  cambridgeshire: [
    "lincolnshire",
    "norfolk",
    "suffolk",
    "essex",
    "hertfordshire",
    "bedfordshire",
    "northamptonshire",
    "peterborough",
  ],
  cheshire: [
    "merseyside",
    "greater manchester",
    "derbyshire",
    "staffordshire",
    "shropshire",
    "flintshire",
  ],
  "city of london": ["greater london"],
  cornwall: ["devon", "isles of scilly"],
  cumbria: [
    "northumberland",
    "durham",
    "north yorkshire",
    "lancashire",
    "dumfries and galloway",
    "scottish borders",
  ],
  derbyshire: [
    "greater manchester",
    "west yorkshire",
    "south yorkshire",
    "nottinghamshire",
    "leicestershire",
    "staffordshire",
    "cheshire",
  ],
  devon: ["cornwall", "somerset", "dorset"],
  dorset: ["devon", "somerset", "wiltshire", "hampshire"],
  durham: ["northumberland", "tyne and wear", "north yorkshire", "cumbria"],
  "east riding of yorkshire": [
    "north yorkshire",
    "south yorkshire",
    "lincolnshire",
    "north lincolnshire",
  ],
  "east sussex": ["kent", "surrey", "west sussex"],
  essex: [
    "greater london",
    "hertfordshire",
    "cambridgeshire",
    "suffolk",
    "kent",
    "thurrock",
  ],
  gloucestershire: [
    "worcestershire",
    "warwickshire",
    "oxfordshire",
    "wiltshire",
    "bristol",
    "south gloucestershire",
    "somerset",
    "herefordshire",
  ],
  "greater london": [
    "kent",
    "surrey",
    "berkshire",
    "buckinghamshire",
    "hertfordshire",
    "essex",
    "city of london",
  ],
  "greater manchester": [
    "merseyside",
    "lancashire",
    "west yorkshire",
    "derbyshire",
    "cheshire",
  ],
  hampshire: [
    "dorset",
    "wiltshire",
    "berkshire",
    "surrey",
    "west sussex",
    "isle of wight",
  ],
  herefordshire: [
    "gloucestershire",
    "worcestershire",
    "shropshire",
    "powys",
    "monmouthshire",
  ],
  hertfordshire: [
    "bedfordshire",
    "buckinghamshire",
    "greater london",
    "essex",
    "cambridgeshire",
  ],
  "isle of wight": ["hampshire"],
  kent: ["greater london", "surrey", "east sussex", "essex", "medway"],
  lancashire: [
    "cumbria",
    "north yorkshire",
    "west yorkshire",
    "greater manchester",
    "merseyside",
  ],
  leicestershire: [
    "nottinghamshire",
    "derbyshire",
    "staffordshire",
    "warwickshire",
    "northamptonshire",
    "rutland",
    "lincolnshire",
  ],
  lincolnshire: [
    "nottinghamshire",
    "south yorkshire",
    "east riding of yorkshire",
    "north lincolnshire",
    "cambridgeshire",
    "rutland",
    "leicestershire",
    "northamptonshire",
    "norfolk",
  ],
  merseyside: ["lancashire", "greater manchester", "cheshire", "flintshire"],
  norfolk: ["lincolnshire", "cambridgeshire", "suffolk"],
  "north yorkshire": [
    "cumbria",
    "durham",
    "west yorkshire",
    "south yorkshire",
    "east riding of yorkshire",
    "lancashire",
  ],
  northamptonshire: [
    "leicestershire",
    "rutland",
    "cambridgeshire",
    "bedfordshire",
    "buckinghamshire",
    "oxfordshire",
    "warwickshire",
    "lincolnshire",
  ],
  northumberland: ["cumbria", "durham", "tyne and wear", "scottish borders"],
  nottinghamshire: [
    "lincolnshire",
    "south yorkshire",
    "derbyshire",
    "leicestershire",
  ],
  oxfordshire: [
    "warwickshire",
    "northamptonshire",
    "buckinghamshire",
    "berkshire",
    "wiltshire",
    "gloucestershire",
  ],
  rutland: ["lincolnshire", "leicestershire", "northamptonshire"],
  shropshire: [
    "cheshire",
    "staffordshire",
    "worcestershire",
    "herefordshire",
    "powys",
    "wrexham",
  ],
  somerset: ["devon", "dorset", "wiltshire", "gloucestershire", "bristol"],
  "south yorkshire": [
    "west yorkshire",
    "north yorkshire",
    "east riding of yorkshire",
    "lincolnshire",
    "nottinghamshire",
    "derbyshire",
  ],
  staffordshire: [
    "cheshire",
    "derbyshire",
    "leicestershire",
    "warwickshire",
    "west midlands",
    "worcestershire",
    "shropshire",
  ],
  suffolk: ["norfolk", "cambridgeshire", "essex"],
  surrey: [
    "greater london",
    "kent",
    "east sussex",
    "west sussex",
    "hampshire",
    "berkshire",
  ],
  "tyne and wear": ["northumberland", "durham"],
  warwickshire: [
    "west midlands",
    "worcestershire",
    "gloucestershire",
    "oxfordshire",
    "northamptonshire",
    "leicestershire",
    "staffordshire",
  ],
  "west midlands": [
    "staffordshire",
    "warwickshire",
    "worcestershire",
    "shropshire",
  ],
  "west sussex": ["surrey", "east sussex", "hampshire"],
  "west yorkshire": [
    "lancashire",
    "north yorkshire",
    "south yorkshire",
    "greater manchester",
  ],
  wiltshire: [
    "gloucestershire",
    "oxfordshire",
    "berkshire",
    "hampshire",
    "dorset",
    "somerset",
  ],
  worcestershire: [
    "shropshire",
    "staffordshire",
    "west midlands",
    "warwickshire",
    "gloucestershire",
    "herefordshire",
  ],
  "isles of scilly": ["cornwall"],
  // Unitary/associated (for tolerance in data you might have):
  peterborough: [
    "cambridgeshire",
    "lincolnshire",
    "northamptonshire",
    "rutland",
  ],
  "south gloucestershire": ["bristol", "gloucestershire"],
  "north lincolnshire": [
    "lincolnshire",
    "east riding of yorkshire",
    "south yorkshire",
    "nottinghamshire",
  ],
  thurrock: ["essex"],
  medway: ["kent"],

  // ---------------- WALES ----------------
  anglesey: ["gwynedd"],
  gwynedd: ["anglesey", "conwy", "denbighshire", "powys", "ceredigion"],
  conwy: ["gwynedd", "denbighshire"],
  denbighshire: ["conwy", "flintshire", "wrexham", "powys", "gwynedd"],
  flintshire: ["denbighshire", "wrexham", "cheshire", "merseyside"],
  wrexham: ["flintshire", "denbighshire", "powys", "shropshire", "cheshire"],
  ceredigion: ["gwynedd", "powys", "carmarthenshire", "pembrokeshire"],
  pembrokeshire: ["ceredigion", "carmarthenshire"],
  carmarthenshire: [
    "ceredigion",
    "pembrokeshire",
    "swansea",
    "neath port talbot",
    "powys",
  ],
  swansea: ["carmarthenshire", "neath port talbot"],
  "neath port talbot": ["swansea", "bridgend", "rhondda cynon taf", "powys"],
  bridgend: ["neath port talbot", "rhondda cynon taf", "vale of glamorgan"],
  "rhondda cynon taf": [
    "bridgend",
    "merthyr tydfil",
    "caerphilly",
    "cardiff",
    "vale of glamorgan",
    "neath port talbot",
    "powys",
  ],
  "vale of glamorgan": ["cardiff", "bridgend", "rhondda cynon taf"],
  cardiff: ["vale of glamorgan", "rhondda cynon taf", "newport", "caerphilly"],
  "merthyr tydfil": ["rhondda cynon taf", "powys", "caerphilly"],
  caerphilly: [
    "cardiff",
    "rhondda cynon taf",
    "merthyr tydfil",
    "blaenau gwent",
    "torfaen",
    "newport",
    "powys",
  ],
  "blaenau gwent": [
    "monmouthshire",
    "torfaen",
    "caerphilly",
    "merthyr tydfil",
    "powys",
  ],
  torfaen: ["monmouthshire", "blaenau gwent", "caerphilly", "newport"],
  newport: [
    "monmouthshire",
    "cardiff",
    "caerphilly",
    "torfaen",
    "gloucestershire",
  ],
  monmouthshire: [
    "newport",
    "torfaen",
    "blaenau gwent",
    "powys",
    "herefordshire",
    "gloucestershire",
  ],
  powys: [
    "gwynedd",
    "ceredigion",
    "carmarthenshire",
    "rhondda cynon taf",
    "merthyr tydfil",
    "caerphilly",
    "blaenau gwent",
    "monmouthshire",
    "shropshire",
    "herefordshire",
    "wrexham",
    "denbighshire",
    "neath port talbot",
  ],

  // ---------------- SCOTLAND (high-level) ----------------
  "scottish borders": [
    "dumfries and galloway",
    "east lothian",
    "midlothian",
    "south lanarkshire",
    "northumberland",
    "cumbria",
  ],
  "dumfries and galloway": [
    "scottish borders",
    "south ayrshire",
    "east ayrshire",
    "south lanarkshire",
    "cumbria",
  ],
  "east lothian": ["midlothian", "city of edinburgh", "scottish borders"],
  midlothian: [
    "east lothian",
    "city of edinburgh",
    "west lothian",
    "scottish borders",
  ],
  "west lothian": [
    "city of edinburgh",
    "falkirk",
    "north lanarkshire",
    "south lanarkshire",
    "midlothian",
  ],
  "city of edinburgh": ["east lothian", "midlothian", "west lothian", "fife"],
  fife: [
    "city of edinburgh",
    "perth and kinross",
    "clackmannanshire",
    "stirling",
    "angus",
  ],
  angus: ["fife", "perth and kinross", "aberdeenshire", "dundee city"],
  "dundee city": ["angus", "perth and kinross"],
  aberdeenshire: ["angus", "moray", "highland", "aberdeen city"],
  "aberdeen city": ["aberdeenshire"],
  moray: ["aberdeenshire", "highland"],
  highland: [
    "moray",
    "aberdeenshire",
    "perth and kinross",
    "argyll and bute",
    "na h-eileanan siar",
  ],
  "na h-eileanan siar": ["highland"],
  "perth and kinross": [
    "highland",
    "argyll and bute",
    "stirling",
    "fife",
    "angus",
  ],
  "argyll and bute": [
    "highland",
    "perth and kinross",
    "stirling",
    "west dunbartonshire",
    "east dunbartonshire",
  ],
  stirling: [
    "argyll and bute",
    "perth and kinross",
    "clackmannanshire",
    "falkirk",
    "north lanarkshire",
  ],
  falkirk: [
    "stirling",
    "west lothian",
    "north lanarkshire",
    "clackmannanshire",
  ],
  clackmannanshire: ["stirling", "fife"],
  "north lanarkshire": [
    "west lothian",
    "falkirk",
    "stirling",
    "argyll and bute",
    "east dunbartonshire",
    "glasgow city",
    "south lanarkshire",
    "west dunbartonshire",
  ],
  "south lanarkshire": [
    "north lanarkshire",
    "glasgow city",
    "east renfrewshire",
    "east ayrshire",
    "dumfries and galloway",
    "scottish borders",
  ],
  "glasgow city": [
    "east dunbartonshire",
    "west dunbartonshire",
    "east renfrewshire",
    "renfrewshire",
    "north lanarkshire",
    "south lanarkshire",
  ],
  "west dunbartonshire": [
    "argyll and bute",
    "east dunbartonshire",
    "glasgow city",
    "renfrewshire",
  ],
  "east dunbartonshire": [
    "argyll and bute",
    "west dunbartonshire",
    "glasgow city",
    "north lanarkshire",
  ],
  renfrewshire: [
    "inverclyde",
    "west dunbartonshire",
    "glasgow city",
    "east renfrewshire",
    "north ayrshire",
  ],
  "east renfrewshire": [
    "glasgow city",
    "renfrewshire",
    "south lanarkshire",
    "north ayrshire",
  ],
  "north ayrshire": [
    "renfrewshire",
    "east renfrewshire",
    "south ayrshire",
    "argyll and bute",
  ],
  "south ayrshire": [
    "north ayrshire",
    "east ayrshire",
    "dumfries and galloway",
  ],
  "east ayrshire": [
    "south ayrshire",
    "east renfrewshire",
    "south lanarkshire",
    "dumfries and galloway",
  ],
  inverclyde: ["renfrewshire", "north ayrshire"],
  "western isles": ["highland"], // alias for na h-eileanan siar

  // ---------------- NORTHERN IRELAND ----------------
  "antrim and newtownabbey": [
    "causeway coast and glens",
    "mid and east antrim",
    "lisburn and castlereagh",
    "belfast",
  ],
  "ards and north down": [
    "belfast",
    "lisburn and castlereagh",
    "newry mourne and down",
  ],
  belfast: [
    "antrim and newtownabbey",
    "lisburn and castlereagh",
    "ards and north down",
  ],
  "causeway coast and glens": [
    "derry city and strabane",
    "mid ulster",
    "mid and east antrim",
    "antrim and newtownabbey",
  ],
  "derry city and strabane": [
    "causeway coast and glens",
    "mid ulster",
    "fermanagh and omagh",
    "donegal",
  ], // includes ROI neighbor for tolerance
  "fermanagh and omagh": [
    "derry city and strabane",
    "mid ulster",
    "armagh banbridge and craigavon",
    "monaghan",
    "leitrim",
    "cavan",
  ],
  "lisburn and castlereagh": [
    "belfast",
    "antrim and newtownabbey",
    "mid and east antrim",
    "armagh banbridge and craigavon",
    "ards and north down",
    "newry mourne and down",
  ],
  "mid and east antrim": [
    "antrim and newtownabbey",
    "causeway coast and glens",
    "mid ulster",
    "lisburn and castlereagh",
  ],
  "mid ulster": [
    "causeway coast and glens",
    "derry city and strabane",
    "fermanagh and omagh",
    "armagh banbridge and craigavon",
    "mid and east antrim",
  ],
  "newry mourne and down": [
    "lisburn and castlereagh",
    "ards and north down",
    "armagh banbridge and craigavon",
    "louth",
    "monaghan",
  ],
  "armagh banbridge and craigavon": [
    "mid ulster",
    "fermanagh and omagh",
    "lisburn and castlereagh",
    "newry mourne and down",
  ],

  // -------- Optional synonyms (helps fuzzy inputs) --------
  wiltshire: [
    "gloucestershire",
    "oxfordshire",
    "berkshire",
    "hampshire",
    "dorset",
    "somerset",
    "bristol",
  ],
  wilts: [
    "gloucestershire",
    "oxfordshire",
    "berkshire",
    "hampshire",
    "dorset",
    "somerset",
    "bristol",
  ],
};

const _norm = (s = "") => String(s).trim().toLowerCase().replace(/\s+/g, " ");

// lightweight aliasing for role “families”
const roleAliases = {
  dj: [
    "dj with decks",
    "dj with mixing console",
    "dj with console",
    "curate setlist",
  ],
  "band leader": ["musical director", "md", "band management", "band manager"],
  "sound engineering": [
    "sound engineer",
    "live audio recording",
    "pa & lights provision",
  ],
  "client liaison": ["client liason", "client liaison"], // typos
};

// UK postcode area = leading letters (one or two letters at start)
const postcodeArea = (postcode = "") => {
  const m = String(postcode)
    .toUpperCase()
    .trim()
    .match(/^([A-Z]{1,2})/);
  return m ? m[1] : "";
};

// 0..1 proximity score from origin to deputy
const computeProximity = (origin = {}, deputy = {}) => {
  const oCounty = _norm(origin?.county || "");
  const oArea = postcodeArea(origin?.postcode || "");
  const dCounty = _norm(deputy?.address?.county || "");
  const dArea = postcodeArea(deputy?.address?.postcode || "");

  if (!oCounty && !oArea) return 0; // nothing to compare

  // simple tiers
  if (oCounty && dCounty && oCounty === dCounty) return 1.0;
  if (oArea && dArea && oArea === dArea) return 0.75;

  // partial letter match on area (e.g., E vs EC) gives a small bump
  if (oArea && dArea && oArea[0] === dArea[0]) return 0.5;

  return 0.0;
};

// 0..1 genre match (intersection / actGenres count)
// Replace your computeGenreFit with this:
const computeGenreFit = (act, dep) => {
  const A = new Set((act || []).map(_norm).filter(Boolean));
  const D = new Set((dep || []).map(_norm).filter(Boolean));
  if (!A.size) return 0;

  // 1.0 if deputy covers every act genre
  let inter = 0;
  for (const g of A) if (D.has(g)) inter++;
  const coverage = inter / A.size;

  // Optional: keep a touch of Jaccard so we don't over-reward "everything" profiles
  const jacc = A.size && D.size ? inter / (A.size + D.size - inter) : 0;

  // Heavier weight on coverage (feel free to tweak 0.8/0.2)
  return 0.8 * coverage + 0.2 * jacc;
};

// ----------------------- Controllers -----------------------

// Fetch a single deputy by ID
async function getDeputyById(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid musician id" });
    }

    // Optional: access control — allow self or agents
    const me = req.user; // set by verifyToken
    const isSelf = me?._id?.toString?.() === id;
    const isAgent = (me?.role || me?.userRole || "").toLowerCase() === "agent";
    if (!isSelf && !isAgent) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const deputy = await musicianModel.findById(id).lean();
    if (!deputy) {
      return res
        .status(404)
        .json({ success: false, message: "Musician not found" });
    }

    return res.json({ success: true, deputy });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

const registerDeputy = async (req, res) => {
  const reqId =
    req.get("x-request-id") ||
    req.body?._requestId ||
    `srv_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const startedAt = Date.now();

  const safePreview = (obj, opts = {}) => {
    const {
      maxArray = 4,
      maxString = 800,
      elideKeys = ["password", "salt", "__v"],
    } = opts;
    const seen = new WeakSet();
    const shrink = (v) => {
      if (v && typeof v === "object") {
        if (seen.has(v)) return "[Circular]";
        seen.add(v);
      }
      if (Array.isArray(v)) {
        const head = v.slice(0, maxArray).map(shrink);
        const extra = v.length - head.length;
        return extra > 0 ? [...head, `…(+${extra})`] : head;
      }
      if (v && typeof v === "object") {
        const out = {};
        for (const k of Object.keys(v)) {
          if (elideKeys.includes(k)) continue;
          out[k] = shrink(v[k]);
        }
        return out;
      }
      if (typeof v === "string" && v.length > maxString) {
        return v.slice(0, maxString) + "…";
      }
      return v;
    };
    return shrink(obj);
  };

  console.group(`📩 NEW DEPUTY REGISTRATION REQUEST [${reqId}]`);
  console.log("📨 receivedAt:", new Date().toISOString());
  console.log("🧾 headers(x-request-id):", req.get("x-request-id"));
  console.log("📁 multer files keys:", Object.keys(req.files || {}));
  console.log("📦 raw body keys:", Object.keys(req.body || {}));

  try {
    const body = req.body;

    // helpers
    const safeParse = (v, fallback) => {
      try {
        return v && typeof v === "string" ? JSON.parse(v) : v ?? fallback;
      } catch {
        return fallback;
      }
    };
    const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
    const stringArray = (v) => asArray(v).map(String).filter(Boolean);
    const urlArray = (v) =>
      stringArray(v).filter((s) => /^https?:\/\//i.test(s));

    // email from basicInfo or top-level
    let email = null;
    try {
      if (typeof body.basicInfo === "string") {
        email = JSON.parse(body.basicInfo || "{}")?.email;
      } else if (body.basicInfo?.email) {
        email = body.basicInfo.email;
      }
    } catch {}
    if (!email && body.email) email = String(body.email).trim().toLowerCase();
    email = email ? email.trim().toLowerCase() : null;

    if (!email) {
      console.warn("⚠️ Missing email in request body");
      console.groupEnd();
      return res
        .status(400)
        .json({ success: false, message: "Email is required." });
    }

    // Find or create
    let musician = await musicianModel.findOne({ email });
    let createdNew = false;
    if (!musician) {
      musician = new musicianModel({ email, status: "pending" });
      createdNew = true;
      console.log("🆕 Creating new musician:", email);
    } else {
      console.log(
        "🟡 Updating existing musician:",
        email,
        musician._id.toString()
      );
    }

    // Parse payload blobs
    const basicInfo = safeParse(body.basicInfo, {});
    const address = safeParse(body.address, musician.address || {});
    const bank = safeParse(body.bank_account, musician.bank_account || {});
    const academic_credentials = safeParse(body.academic_credentials, []);
    const agreementCheckboxes = safeParse(body.agreementCheckboxes, []);
    const paAndBackline = safeParse(body.paAndBackline, []); // optional
    const backline = safeParse(body.backline, []);
    const vocalMics = safeParse(body.vocalMics, {});
    const inEarMonitoring = safeParse(body.inEarMonitoring, {});
    const instrumentMics = safeParse(body.instrumentMics, {});
    const speechMics = safeParse(body.speechMics, {});
    const instrumentation = safeParse(body.instrumentation, []);
    const awards = safeParse(body.awards, []);
    const sessions = safeParse(body.sessions, []);
    const function_bands_performed_with = safeParse(
      body.function_bands_performed_with,
      []
    );
    const original_bands_performed_with = safeParse(
      body.original_bands_performed_with,
      []
    );
    const social_media_links = safeParse(body.social_media_links, []);
    const customRepertoire =
  typeof body.customRepertoire === "string" ? body.customRepertoire : "";
    const selectedSongs = safeParse(body.selectedSongs, []);
    const other_skills = safeParse(body.other_skills, []);
    const logistics = safeParse(body.logistics, []);

    const normalizeBandRefs = (arr, nameKey, emailKey) =>
      (Array.isArray(arr) ? arr : [])
        .map((x) => ({
          [nameKey]: String(x?.[nameKey] || "").trim(),
          [emailKey]: String(x?.[emailKey] || "")
            .trim()
            .toLowerCase(),
        }))
        // keep row only if at least one field is present
        .filter((x) => x[nameKey] || x[emailKey]);

    const functionBandsClean = normalizeBandRefs(
      function_bands_performed_with,
      "function_band_name",
      "function_band_leader_email"
    );

    const originalBandsClean = normalizeBandRefs(
      original_bands_performed_with,
      "original_band_name",
      "original_band_leader_email"
    );

    // ---- Video links: accept JSON array/string, normalize to [{title,url}] and drop empties
    const parseArrayField = (v, fallback = []) => {
      if (Array.isArray(v)) return v;
      if (typeof v === "string") {
        try {
          return JSON.parse(v);
        } catch {
          return fallback;
        }
      }
      return fallback;
    };

    // ✅ persist the nested basicInfo block too (so it saves in Mongo)
    musician.basicInfo = {
      firstName: String(
        basicInfo?.firstName ??
          body.firstName ??
          musician.basicInfo?.firstName ??
          musician.firstName ??
          ""
      ).trim(),

      lastName: String(
        basicInfo?.lastName ??
          body.lastName ??
          musician.basicInfo?.lastName ??
          musician.lastName ??
          ""
      ).trim(),

      phone: String(
        basicInfo?.phone ??
          body.phone ??
          musician.basicInfo?.phone ??
          musician.phone ??
          ""
      ).trim(),

      // prefer the already-normalized `email` you computed above
      email: String(
        basicInfo?.email ??
          body.email ??
          musician.basicInfo?.email ??
          email ??
          ""
      )
        .trim()
        .toLowerCase(),
    };

    musician.markModified("basicInfo");

    const functionBandVideoLinks = parseArrayField(body.functionBandVideoLinks)
      .map((x) => ({
        title: (x?.title || "").trim(),
        url: (x?.url || "").trim(),
      }))
      .filter((x) => x.url);

    const tscApprovedFunctionBandVideoLinks = parseArrayField(
      body.tscApprovedFunctionBandVideoLinks
    )
      .map((x) => ({
        title: (x?.title || "").trim(),
        url: (x?.url || "").trim(),
      }))
      .filter((x) => x.url);

    const originalBandVideoLinks = parseArrayField(body.originalBandVideoLinks)
      .map((x) => ({
        title: (x?.title || "").trim(),
        url: (x?.url || "").trim(),
      }))
      .filter((x) => x.url);

    const tscApprovedOriginalBandVideoLinks = parseArrayField(
      body.tscApprovedOriginalBandVideoLinks
    )
      .map((x) => ({
        title: (x?.title || "").trim(),
        url: (x?.url || "").trim(),
      }))
      .filter((x) => x.url);

    // lighting / PA
    const cableLogistics = safeParse(body.cableLogistics, []);
    const extensionCableLogistics = safeParse(body.extensionCableLogistics, []);
    const uplights = safeParse(body.uplights, []);
    const tbars = safeParse(body.tbars, []);
    const lightBars = safeParse(body.lightBars, []);
    const discoBall = safeParse(body.discoBall, []);
    const otherLighting = safeParse(body.otherLighting, []);
    const paSpeakerSpecs = safeParse(body.paSpeakerSpecs, []);
    const mixingDesk = safeParse(body.mixingDesk, []);
    const floorMonitorSpecs = safeParse(body.floorMonitorSpecs, []);
    const djEquipment = safeParse(body.djEquipment, []);
    const additionalEquipment = safeParse(body.additionalEquipment, {});

    const djEquipmentCategories = safeParse(body.djEquipmentCategories, []);
    const djGearRequired = safeParse(body.djGearRequired, []);
    const instrumentSpecsRaw = safeParse(body.instrumentSpecs, []);
const instrumentSpecs = (Array.isArray(instrumentSpecsRaw) ? instrumentSpecsRaw : [])
  .map((x) => ({
    name: String(x?.name || "").trim(),
    wattage: Number(x?.wattage || 0),
  }))
  .filter((x) => x.name || x.wattage > 0);
    // wardrobe / extra images as URL strings
    const digitalWardrobeBlackTie = urlArray(body.digitalWardrobeBlackTie);
    const digitalWardrobeFormal = urlArray(body.digitalWardrobeFormal);
    const digitalWardrobeSmartCasual = urlArray(
      body.digitalWardrobeSmartCasual
    );
    const digitalWardrobeSessionAllBlack = urlArray(
      body.digitalWardrobeSessionAllBlack
    );
    const additionalImages = urlArray(body.additionalImages);

    // ---- MP3s: files OR JSON
    let coverMp3s = [];
    let originalMp3s = [];
    if (req.files?.coverMp3s?.length) {
      coverMp3s = req.files.coverMp3s.map((f) => ({ title: "", url: f.path }));
    } else {
      const coverMp3sBody = safeParse(body.coverMp3s, []);
      if (Array.isArray(coverMp3sBody)) {
        coverMp3s = coverMp3sBody
          .map((x) =>
            typeof x === "string"
              ? { title: "", url: x }
              : { title: x?.title || "", url: x?.url || "" }
          )
          .filter((m) => m.url);
      }
    }
    if (req.files?.originalMp3s?.length) {
      originalMp3s = req.files.originalMp3s.map((f) => ({
        title: "",
        url: f.path,
      }));
    } else {
      const originalMp3sBody = safeParse(body.originalMp3s, []);
      if (Array.isArray(originalMp3sBody)) {
        originalMp3s = originalMp3sBody
          .map((x) =>
            typeof x === "string"
              ? { title: "", url: x }
              : { title: x?.title || "", url: x?.url || "" }
          )
          .filter((m) => m.url);
      }
    }

    // Log the parsed/normalized view (START snapshot)
    const normalizedPreview = safePreview(
      {
        email,
        basicInfo,
        address,
        bank,
        academic_credentials,
        agreementCheckboxes,
        backline,
        vocalMics,
        inEarMonitoring,
        instrumentMics,
        speechMics,
        instrumentation,
        awards,
        sessions,
        function_bands_performed_with: functionBandsClean,
        original_bands_performed_with: originalBandsClean,
        social_media_links,
        selectedSongs,
        other_skills,
        logistics,
        functionBandVideoLinks,
        tscApprovedFunctionBandVideoLinks,
        originalBandVideoLinks,
        tscApprovedOriginalBandVideoLinks,
        cableLogistics,
        extensionCableLogistics,
        uplights,
        tbars,
        lightBars,
        discoBall,
        otherLighting,
        paSpeakerSpecs,
        mixingDesk,
        floorMonitorSpecs,
        djEquipment,
        djEquipmentCategories,
        djGearRequired,
        instrumentSpecs,
        digitalWardrobeBlackTie,
        digitalWardrobeFormal,
        digitalWardrobeSmartCasual,
        digitalWardrobeSessionAllBlack,
        additionalImages,
        coverMp3sLen: coverMp3s.length,
        originalMp3sLen: originalMp3s.length,
        deputy_contract_agreed: body.deputy_contract_agreed,
        deputy_contract_signed: body.deputy_contract_signed,
        dateRegistered: body.dateRegistered,
      },
      { maxArray: 3 }
    );
    console.groupCollapsed(`🧪 START parsed payload [${reqId}]`);
    console.log(normalizedPreview);
    console.groupEnd();

    // simple fields
    musician.firstName = (
      body.firstName ||
      basicInfo.firstName ||
      musician.firstName ||
      ""
    ).trim();
    musician.lastName = (
      body.lastName ||
      basicInfo.lastName ||
      musician.lastName ||
      ""
    ).trim();
    musician.phone = (
      body.phone ||
      basicInfo.phone ||
      musician.phone ||
      ""
    ).trim();
    musician.role = body.role || musician.role || "musician";
    musician.status = musician.status || "pending";
    musician.bio = body.bio ?? musician.bio ?? "";
    musician.tscApprovedBio =
      body.tscApprovedBio ?? musician.tscApprovedBio ?? "";
    musician.tagLine = body.tagLine ?? musician.tagLine ?? "";

    if (body.dateRegistered) {
      const d = new Date(body.dateRegistered);
      if (!isNaN(d)) musician.dateRegistered = d;
    }

    // contracts
    const agreed = safeParse(body.deputy_contract_agreed, null);
    if (typeof agreed === "boolean") {
      musician.deputy_contract_agreed = agreed;
    } else if (typeof agreed === "string") {
      musician.deputy_contract_agreed = agreed === "true";
    }
    if (typeof body.deputy_contract_signed === "string") {
      musician.deputy_contract_signed = body.deputy_contract_signed;
    }

    // nested assigns
    musician.address = address;
    musician.bank_account = bank;
    musician.academic_credentials = academic_credentials;
    musician.agreementCheckboxes = agreementCheckboxes;
    musician.paAndBackline = paAndBackline;
    musician.backline = backline;
    musician.vocalMics = vocalMics;
    musician.inEarMonitoring = inEarMonitoring;
    musician.instrumentMics = instrumentMics;
    musician.speechMics = speechMics;
    musician.instrumentation = instrumentation;
    musician.awards = awards;
    musician.sessions = sessions;
    musician.function_bands_performed_with = functionBandsClean;
    musician.original_bands_performed_with = originalBandsClean;
    musician.social_media_links = social_media_links;
musician.customRepertoire = customRepertoire;
    musician.selectedSongs = selectedSongs;
    musician.other_skills = other_skills;
    musician.logistics = logistics;

    // videos
    musician.functionBandVideoLinks = functionBandVideoLinks;
    musician.tscApprovedFunctionBandVideoLinks =
      tscApprovedFunctionBandVideoLinks;
    musician.originalBandVideoLinks = originalBandVideoLinks;
    musician.tscApprovedOriginalBandVideoLinks =
      tscApprovedOriginalBandVideoLinks;

    // lighting / PA
    musician.cableLogistics = cableLogistics;
    musician.extensionCableLogistics = extensionCableLogistics;
    musician.uplights = uplights;
    musician.tbars = tbars;
    musician.lightBars = lightBars;
    musician.discoBall = discoBall;
    musician.otherLighting = otherLighting;
    musician.paSpeakerSpecs = paSpeakerSpecs;
    musician.mixingDesk = mixingDesk;
    musician.floorMonitorSpecs = floorMonitorSpecs;
    musician.djEquipment = djEquipment;
    musician.djEquipmentCategories = djEquipmentCategories;
    musician.djGearRequired = djGearRequired;
    musician.instrumentSpecs = instrumentSpecs;
musician.additionalEquipment = additionalEquipment;
    // wardrobe/images
    musician.digitalWardrobeBlackTie = digitalWardrobeBlackTie;
    musician.digitalWardrobeFormal = digitalWardrobeFormal;
    musician.digitalWardrobeSmartCasual = digitalWardrobeSmartCasual;
    musician.digitalWardrobeSessionAllBlack = digitalWardrobeSessionAllBlack;
    musician.additionalImages = additionalImages;

    // mp3s
    musician.coverMp3s = coverMp3s;
    musician.originalMp3s = originalMp3s;

    // vocals
    if (!musician.vocals) musician.vocals = {};
    const vocalsParsed = safeParse(body.vocals, {});
    musician.vocals.type = Array.isArray(vocalsParsed.type)
      ? vocalsParsed.type
      : [];
    musician.vocals.gender = vocalsParsed.gender || "";
    musician.vocals.range = vocalsParsed.range || "";
    musician.vocals.rap =
      vocalsParsed.rap === true || vocalsParsed.rap === "true";
    musician.vocals.genres = Array.isArray(vocalsParsed.genres)
      ? vocalsParsed.genres
      : [];

  const isHttpUrl = (s) => typeof s === "string" && /^https?:\/\//i.test(s);

// 1) If file uploaded, use it
if (req.files?.profilePicture?.[0]) {
  const f = req.files.profilePicture[0];
  if (f.buffer) {
    const up = await uploader(f.buffer, f.originalname || "profile.jpg", "musicians");
    musician.profilePhoto = up.secure_url;
  } else if (f.path && /^https?:\/\//i.test(f.path)) {
    musician.profilePhoto = f.path;
  }
} else {
  // 2) Otherwise accept URL string from body
  const bodyProfileUrl = body.profilePhoto || body.profilePicture || null;
  if (isHttpUrl(bodyProfileUrl)) musician.profilePhoto = bodyProfileUrl;
}

if (req.files?.coverHeroImage?.[0]) {
  const f = req.files.coverHeroImage[0];
  if (f.buffer) {
    const up = await uploader(f.buffer, f.originalname || "cover.jpg", "musicians");
    musician.coverHeroImage = up.secure_url;
  } else if (f.path && /^https?:\/\//i.test(f.path)) {
    musician.coverHeroImage = f.path;
  }
} else {
  if (isHttpUrl(body.coverHeroImage)) musician.coverHeroImage = body.coverHeroImage;

}

if (req.files?.coverHeroImage?.[0]) {
  const f = req.files.coverHeroImage[0];

  if (f.buffer) {
    const up = await uploader(f.buffer, f.originalname || "cover.jpg", "musicians");
    musician.coverHeroImage = up.secure_url;
  } else if (f.path && /^https?:\/\//i.test(f.path)) {
    // multer-storage-cloudinary often gives a URL-ish path
    musician.coverHeroImage = f.path;
  }
}

    // mark modified where helpful
    musician.markModified("vocalMics");
    musician.markModified("inEarMonitoring");
    musician.markModified("instrumentMics");
    musician.markModified("speechMics");
    musician.markModified("instrumentation");
    musician.markModified("instrumentSpecs");
    musician.markModified("customRepertoire");
    musician.markModified("selectedSongs");
    musician.markModified("function_bands_performed_with");
    musician.markModified("original_bands_performed_with");
    musician.markModified("social_media_links");
    musician.markModified("functionBandVideoLinks");
    musician.markModified("tscApprovedFunctionBandVideoLinks");
    musician.markModified("originalBandVideoLinks");
    musician.markModified("tscApprovedOriginalBandVideoLinks");
    musician.markModified("digitalWardrobeBlackTie");
    musician.markModified("digitalWardrobeFormal");
    musician.markModified("digitalWardrobeSmartCasual");
    musician.markModified("digitalWardrobeSessionAllBlack");
    musician.markModified("additionalImages");
    musician.markModified("coverMp3s");
    musician.markModified("originalMp3s");
    musician.markModified("vocals");
musician.markModified("cableLogistics");
musician.markModified("extensionCableLogistics");
musician.markModified("uplights");
musician.markModified("tbars");
musician.markModified("lightBars");
musician.markModified("discoBall");
musician.markModified("otherLighting");
musician.markModified("paSpeakerSpecs");
musician.markModified("mixingDesk");
musician.markModified("floorMonitorSpecs");
musician.markModified("djEquipment");
musician.markModified("djEquipmentCategories");
musician.markModified("djGearRequired");
musician.markModified("backline");
musician.markModified("additionalEquipment");
musician.bank_account = bank;
musician.markModified("bank_account");
    const saved = await musician.save();

    // END snapshot: read back from DB to confirm persisted shape
    const roundTrip = await musicianModel.findById(saved._id).lean();
    console.groupCollapsed(
      `✅ SAVED & FETCHED BACK [${reqId}] id=${saved._id.toString()}`
    );
    console.log(
      "Saved keys:",
      Object.keys(saved.toObject ? saved.toObject() : saved)
    );
    console.log("Round-trip summary:", safePreview(roundTrip));
    console.groupEnd();

    const elapsed = Date.now() - startedAt;
    console.log(`⏱️ Completed in ${elapsed}ms [${reqId}]`);
    console.groupEnd();

    return res.status(201).json({
      success: true,
      message: createdNew ? "Deputy submitted for approval" : "Deputy updated",
      requestId: reqId,
      musician: {
        _id: saved._id,
        email: saved.email,
        status: saved.status,
        firstName: saved.firstName,
        lastName: saved.lastName,
      },
    });
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    console.error(
      `❌ Deputy registration failed [${reqId}] after ${elapsed}ms:`,
      err
    );
    console.groupEnd();
    return res.status(400).json({
      success: false,
      message: "Deputy registration failed",
      error: err.message,
      requestId: reqId,
    });
  }
};

const createToken = (user) =>
  jwt.sign(
    { id: user._id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
    }
  );

const getMyDrafts = async (req, res) => {
  try {
    const drafts = await actModel.find({
      status: "draft",
      createdBy: req.user._id,
    });
    res.json({ success: true, drafts });
  } catch (err) {
    console.error("Error fetching drafts:", err);
    res.status(500).json({ success: false, message: "Failed to fetch drafts" });
  }
};

const saveActDraft = async (req, res) => {
  console.log(
    "✅ Received saveDraft payload:",
    JSON.stringify(req.body, null, 2)
  );
  const { id } = req.body;
  const actData = req.body;

  try {
    let act;
    if (id) {
      act = await actModel.findByIdAndUpdate(id, actData, { new: true });
    } else {
      act = new actModel({ ...actData, status: "draft" });
      await act.save();
    }
    if (!act.status) {
      act.status = "draft";
    }

    res
      .status(200)
      .json({ success: true, actId: act._id, message: "Draft saved" });
  } catch (err) {
    console.error("Error saving act draft:", err);
    res.status(500).json({ success: false, message: "Failed to save draft" });
  }
};

// Registration (generic)
const registerMusician = async (req, res) => {
  try {
    let profileUrl = "";
    if (req.file) {
      const result = await uploader(req.file.path, "musicians");
      profileUrl = result.secure_url;
    }

    const newMusician = new musicianModel({
      ...JSON.parse(req.body), // or parse fields manually
      profile_picture: profileUrl,
      // removed coverHeroImage: coverHeroUrl (undefined here)
    });

    await newMusician.save();
    res.status(201).json({ success: true, message: "Musician registered" });
  } catch (err) {
    console.error("❌ Registration failed:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const saveAmendmentDraft = async (req, res) => {
  const { id, updates } = req.body;
  const userEmail = req.user?.email || "unknown";

  try {
    const act = await actModel.findById(id);
    if (!act)
      return res.status(404).json({ success: false, message: "Act not found" });

    if (act.status === "approved") {
      act.amendment = {
        isPending: true,
        changes: updates,
        lastEditedBy: userEmail,
        lastEditedAt: new Date(),
      };
      await act.save();
      return res.json({ success: true, message: "Amendment draft saved" });
    } else {
      await actModel.findByIdAndUpdate(id, updates, { new: true });
      return res.json({ success: true, message: "Act updated" });
    }
  } catch (err) {
    console.error("❌ Error saving amendment draft:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to save amendment draft" });
  }
};

// Login
// Login
const loginMusician = async (req, res) => {
  try {
    let { email, password } = req.body;

    // 🔥 1) Normalise email
    const normEmail = (email || "").trim().toLowerCase();

    if (!normEmail || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    console.log("🔍 Attempting login for:", normEmail);

    // 🔥 2) Find musician safely
    const user = await musicianModel.findOne({
      email: normEmail,
    });

    if (!user) {
      console.warn("❌ No user found for email:", normEmail);
      return res.status(404).json({
        success: false,
        message: "No account found for that email",
      });
    }

    // 🔥 3) Validate password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.warn("❌ Wrong password for:", normEmail);
      return res.status(401).json({
        success: false,
        message: "Incorrect password",
      });
    }

    // 🔥 4) Create access token (no password included!)
    const accessToken = jwt.sign(
      {
        id: user._id,
        email: user.email,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
      },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    // 🔥 5) Create refresh token
    const refreshToken = jwt.sign(
      { id: user._id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    // 🔥 6) Set refresh token cookie
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "None",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    console.log("✅ Login successful for:", user.email);

    // 🔥 7) Send safe response
    return res.status(200).json({
      success: true,
      token: accessToken,
      userId: user._id,
      role: user.role,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      message: "Login successful",
    });
  } catch (error) {
    console.error("🔥 Login error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// Example utility
const calculateTotalPerformanceFee = (lineup) => {
  let total = 0;
  lineup.bandMembers.forEach((member) => {
    if (member.isStandard) {
      const fee = parseFloat(member.fee) || 0;
      total += fee;
    }
    (member.additionalRoles || []).forEach((role) => {
      if (role.isStandard) {
        const roleFee = parseFloat(role.fee) || 0;
        total += roleFee;
      }
    });
  });
  return total;
};

const addAct = async (req, res) => {
  try {
    console.log("✅ Received request to add act");
    console.log("🧾 Body:", req.body);
    console.log("🔍 Parsed name field:", req.body.name);

    const videosParsed = safeJSONParse(req.body.videos, []);

    const {
      name,
      tscName,
      description,
      bio,
      customRepertoire,
      eDrums,
      iems,
      ampless,
      withoutDrums,
      acoustic,
      anotherVocalist,
      pli,
      pliAmount,
      pliExpiry,
      roamingPercussion,
      patCert,
      patExpiry,
      vatRegistered,
      useCountyTravelFee,
      costPerMile,
      discountToClient,
      paSystem,
      lightingSystem,
      bestseller,
      status,
      setlist,
      tscDescription,
      tscVideos,
      tscApprovedBio,
    } = req.body;

    const lineups = safeJSONParse(req.body.lineups, []);
    const genreParsed = safeJSONParse(req.body.genre, []);
    const numberOfSetsParsed = safeJSONParse(req.body.numberOfSets, []);
    const lengthOfSetsParsed = safeJSONParse(req.body.lengthOfSets, []);
    const minimumIntervalLengthParsed = safeJSONParse(
      req.body.minimumIntervalLength,
      []
    );
    
    const selectedSongsParsed = safeJSONParse(req.body.selectedSongs, []);

    const images = req.files.images || [];
    const pliFiles = req.files.pliFile || [];
    const patFiles = req.files.patFile || [];
    const riskAssessments = req.files.riskAssessment || [];
    const mp3Files = req.files?.coverMp3s || [];
    const mp3Titles = Array.isArray(req.body.coverMp3Titles)
      ? req.body.coverMp3Titles
      : [req.body.coverMp3Titles];
    const originalMp3Files = req.files?.originalMp3s || [];
    const originalMp3Titles = Array.isArray(req.body.originalMp3Titles)
      ? req.body.originalMp3Titles
      : [req.body.originalMp3Titles];

    const mp3s = await Promise.all(
      mp3Files.map(async (file, i) => ({
        title: mp3Titles[i],
        url: await uploadToCloudinary(file.buffer, file.originalname, "mp3s"),
      }))
    );

    let imagesUrl = [],
      pliFileUrl = "",
      patFileUrl = "",
      riskAssessmentUrl = "";

    if (images.length) {
      imagesUrl = await Promise.all(
        images.map((file, index) => {
          const name = file.originalname || `image_${index}.jpg`;
          return uploadToCloudinary(file.buffer, name);
        })
      );
    }

    if (pliFiles.length) {
      pliFileUrl = await uploadToCloudinary(
        pliFiles[0].buffer,
        pliFiles[0].originalname,
        "raw"
      );
    }
    if (patFiles.length) {
      patFileUrl = await uploadToCloudinary(
        patFiles[0].buffer,
        patFiles[0].originalname,
        "raw"
      );
    }
    if (riskAssessments.length) {
      riskAssessmentUrl = await uploadToCloudinary(
        riskAssessments[0].buffer,
        riskAssessments[0].originalname,
        "raw"
      );
    }

    const countyFeesParsed = safeJSONParse(req.body.countyFees, {});
    const extrasParsed = safeJSONParse(req.body.extras, {});

    const updatedFeeAllocations = lineups.map((lineup) => {
      const actSize = lineup.actSize;
      const feeAllocations = {};
      let total_fee = 0;

      lineup.bandMembers.forEach((member, index) => {
        if (member.isEssential) {
          const fee = parseFloat(member.fee) || 0;
          total_fee += fee;
          const key = member.instrument || `member_${index}`;
          feeAllocations[key] = fee;
        }

        (member.additionalRoles || []).forEach((role, rIndex) => {
          if (role.isEssential) {
            const roleFee = parseFloat(role.fee) || 0;
            total_fee += roleFee;
            const key = role.role || `role_${rIndex}`;
            feeAllocations[key] = roleFee;
          }
        });
      });

      return {
        act_size: actSize,
        total_fee,
        fee_allocations: feeAllocations,
      };
    });

    // Normalize additional roles into role/additionalFee arrays
    lineups.forEach((lineup) => {
      lineup.bandMembers.forEach((member) => {
        if (member.additionalRoles && Array.isArray(member.additionalRoles)) {
          const customRoles = [];
          const additionalFees = [];

          member.additionalRoles.forEach((r) => {
            if (r.role) customRoles.push(r.role);
            additionalFees.push(parseFloat(r.fee) || 0);
          });

          member.role = customRoles.filter((role) => !!role?.trim());
          member.additionalFee = additionalFees.filter((fee) => !isNaN(fee));
        }
      });
    });

    const actData = {
      name,
      tscName,
      description,
      bio,
      images: imagesUrl,
      videos: videosParsed,
      mp3s,
      genre: genreParsed,
      lineups,
      eDrums: eDrums === "true",
      roamingPercussion: roamingPercussion === "true",
      iems: iems === "true",
      ampless: ampless === "true",
      withoutDrums: withoutDrums === "true",
      acoustic: acoustic === "true",
      anotherVocalist: anotherVocalist === "true",
      numberOfSets: numberOfSetsParsed,
      lengthOfSets: lengthOfSetsParsed,
      minimumIntervalLength: minimumIntervalLengthParsed,
      customRepertoire,
      selectedSongs: selectedSongsParsed,
      pli: pli === "true",
      pliAmount: Number(pliAmount) || 0,
      pliExpiry: pliExpiry ? new Date(pliExpiry) : null,
      pliFile: pliFileUrl,
      patCert: patCert === "true",
      patExpiry: patExpiry ? new Date(patExpiry) : null,
      patFile: patFileUrl,
      riskAssessment: riskAssessmentUrl,
      vatRegistered: vatRegistered === "true",
      useCountyTravelFee: useCountyTravelFee === "true",
      countyFees: countyFeesParsed,
      costPerMile: Number(costPerMile) || 0,
      extras: extrasParsed,
      status: status || "pending",
      bestseller: bestseller === "true",
      discountToClient: Number(discountToClient) || 0,
      isPercentage: req.body.isPercentage === "true",
      createdBy: req.user?._id,
      createdByName:
        (req.user?.firstName || "") + " " + (req.user?.lastName || ""),
      createdByEmail: req.user?.email || "",
      dateRegistered: new Date(),
      base_fee: updatedFeeAllocations,
      paSystem: req.body.paSystem || "",
      lightingSystem: req.body.lightingSystem || "",
      setlist: req.body.setlist || "",
      tscName,
      tscDescription,
      tscVideos,
      tscApprovedBio,
    };

    console.log("📋 Prepared actData name:", actData.name);
    console.log("📦 Final act data:", actData);

    const act = new actModel(actData);
    await act.save();

    console.log("✅ Act saved to MongoDB");
    res.json({ success: true, message: "Act Registered" });
  } catch (error) {
    console.error("❌ Error in addAct:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// List acts
const listActs = async (req, res) => {
  try {
    const acts = await actModel.find({});
    res.json({ success: true, acts });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// Remove act
const removeAct = async (req, res) => {
  try {
    console.log("💥 Incoming ID to delete:", req.body.id);
    if (!req.body.id) throw new Error("No ID provided");

    const deleted = await actModel.findByIdAndDelete(req.body.id);
    if (!deleted) throw new Error("Act not found");

    res.json({ success: true, message: "Act Removed" });
  } catch (error) {
    console.error("❌ Remove error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Single act info
const singleAct = async (req, res) => {
  try {
    const { actId } = req.body;
    const act = await actModel.findById(actId);
    res.json({ success: true, act });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// Update act status
const updateActStatus = async (req, res) => {
  const { id, status, approvedName, approvedBio, approvedVideos } = req.body;
  try {
    const act = await actModel.findByIdAndUpdate(
      id,
      {
        status,
        approvedName,
        approvedBio,
        approvedVideos,
      },
      { new: true }
    );

    if (!act)
      return res.status(404).json({ success: false, message: "Act not found" });

    // If approved and createdBy exists, notify creator
    if (status === "approved" && act.createdBy) {
      const user = await musicianModel.findById(act.createdBy); // ✅ Fix: use musicianModel

      if (user?.email) {
        const transporter = nodemailer.createTransport({
          service: "Gmail",
          auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_PASS,
          },
        });

        await transporter.sendMail({
          from: `"The Supreme Collective" <${process.env.GMAIL_USER}>`,
          to: user.email,
          subject: "Your act has been approved 🎉",
          html: `
            <h2>Congratulations, ${user.firstName || "musician"}!</h2>
            <p>Your act <strong>${
              act.name
            }</strong> has been reviewed and approved by our team.</p>
            <p>It's now live on The Supreme Collective platform!</p>
            <p>Thank you for joining us,<br/>The Supreme Collective Team</p>
          `,
        });
      }
    }

    res.json({ success: true, message: `Act status updated to ${status}` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const approveAmendment = async (req, res) => {
  const { id } = req.body;

  const act = await actModel.findById(id);
  if (!act?.amendment?.isPending)
    return res
      .status(400)
      .json({ success: false, message: "No amendment pending" });

  Object.assign(act, act.amendment.changes);
  act.amendment = {
    isPending: false,
    changes: {},
    lastEditedBy: "",
    lastEditedAt: null,
  };

  await act.save();
  res.json({ success: true, message: "Amendment approved and applied" });
};

// Pending deputies list / approve / reject
const listPendingDeputies = async (req, res) => {
  try {
    const deputies = await musicianModel.find({
      status: "pending",
      role: "musician",
    });
    res.json({ success: true, deputies });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch pending deputies" });
  }
};

const approveDeputy = async (req, res) => {
  const { id } = req.body;
  try {
    await musicianModel.findByIdAndUpdate(id, { status: "approved" });
    res.json({ success: true, message: "Deputy approved" });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, message: "Failed to approve deputy" });
  }
};

const rejectDeputy = async (req, res) => {
  const { id } = req.body;
  try {
    await musicianModel.findByIdAndUpdate(id, { status: "rejected" });
    res.json({ success: true, message: "Deputy rejected" });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, message: "Failed to reject deputy" });
  }
};

// Update act
const updateAct = async (req, res) => {
  try {
    const act = await actModel.findById(req.params.id);
    if (!act)
      return res.status(404).json({ success: false, message: "Act not found" });

    const {
      name,
      tscName,
      description,
      bio,
      status,
      costPerMile,
      pliAmount,
      pliExpiry,
      patExpiry,
      discountToClient,
    } = req.body;

    const images = req.files?.images || [];
    const pliFile = req.files?.pliFile?.[0];
    const patFile = req.files?.patFile?.[0];
    const riskFile = req.files?.riskAssessment?.[0];
    const mp3Files = req.files?.mp3s || [];
    const mp3Titles = Array.isArray(req.body.mp3Titles)
      ? req.body.mp3Titles
      : [req.body.mp3Titles];

    if (images.length) {
      act.images = await Promise.all(
        images.map((img) => uploadToCloudinary(img.buffer, img.originalname))
      );
    }
    if (pliFile)
      act.pliFile = await uploadToCloudinary(
        pliFile.buffer,
        pliFile.originalname,
        "raw"
      );
    if (patFile)
      act.patFile = await uploadToCloudinary(
        patFile.buffer,
        patFile.originalname,
        "raw"
      );
    if (riskFile)
      act.riskAssessment = await uploadToCloudinary(
        riskFile.buffer,
        riskFile.originalname,
        "raw"
      );
    if (mp3Files.length) {
      act.mp3s = await Promise.all(
        mp3Files.map(async (file, i) => ({
          title: mp3Titles[i],
          url: await uploadToCloudinary(file.buffer, file.originalname, "mp3s"),
        }))
      );
    }

    act.name = name || act.name;
    act.tscName = tscName || act.tscName;
    act.description = description || act.description;
    act.bio = bio || act.bio;
    act.status = status || act.status;
    act.pliAmount = Number(pliAmount) || act.pliAmount;
    act.pliExpiry = pliExpiry ? new Date(pliExpiry) : act.pliExpiry;
    act.patExpiry = patExpiry ? new Date(patExpiry) : act.patExpiry;
    act.discountToClient = Number(discountToClient) || act.discountToClient;
    act.costPerMile = Number(costPerMile) || act.costPerMile;

    act.genre = safeJSONParse(req.body.genre, act.genre);
    act.lineups = safeJSONParse(req.body.lineups, act.lineups);
    act.extras = safeJSONParse(req.body.extras, act.extras);
    act.selectedSongs = safeJSONParse(
      req.body.selectedSongs,
      act.selectedSongs
    );

    await act.save();
    res.json({ success: true, message: "Act updated", act });
  } catch (err) {
    console.error("❌ Error updating act:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const rejectAct = async (req, res) => {
  try {
    const { id } = req.body;
    const act = await actModel.findById(id);
    if (!act)
      return res.status(404).json({ success: false, message: "Act not found" });

    act.status = "rejected";
    await act.save();

    res.json({ success: true, message: "Act rejected" });
  } catch (err) {
    console.error("Reject act error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const refreshAccessToken = async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      return res
        .status(401)
        .json({ success: false, message: "No refresh token" });
    }

    jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET,
      async (err, decoded) => {
        if (err)
          return res
            .status(403)
            .json({ success: false, message: "Invalid refresh token" });

        const user = await musicianModel.findById(decoded.id);
        if (!user)
          return res
            .status(404)
            .json({ success: false, message: "User not found" });

        const newAccessToken = jwt.sign(
          { id: user._id, email: user.email, role: user.role },
          process.env.JWT_SECRET,
          { expiresIn: "15m" }
        );

        return res.json({ success: true, token: newAccessToken });
      }
    );
  } catch (error) {
    console.error("Refresh error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const logoutMusician = (req, res) => {
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: false, // dev
    sameSite: "Strict",
  });
  res.json({ success: true, message: "Logged out successfully" });
};

// Email Deputy Contract
const emailContract = async (req, res) => {
  try {
    const { formData } = req.body;
    if (!formData || !formData.email) {
      return res
        .status(400)
        .json({ success: false, message: "Missing form data" });
    }

    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();

    await page.setContent(
      formData.deputy_contract_text || "<p>No contract content</p>",
      {
        waitUntil: "networkidle0",
      }
    );

    const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });
    await browser.close();

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
      },
    });

    const mailOptions = {
      from: `"The Supreme Collective" <${process.env.EMAIL_USER}>`,
      to: [formData.email, "hello@thesupremecollective.co.uk"],
      subject: `Contract Confirmation - ${formData.firstName} ${formData.lastName}`,
      text: "Attached is a signed copy of your contract with The Supreme Collective.",
      attachments: [
        {
          filename: `Contract-${formData.firstName}-${formData.lastName}.pdf`,
          content: pdfBuffer,
        },
      ],
    };

    await transporter.sendMail(mailOptions);

    res
      .status(200)
      .json({ success: true, message: "Contract emailed successfully" });
  } catch (err) {
    console.error("Email contract error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to send contract" });
  }
};


const appendDeputyRepertoire = async (req, res) => {
  try {
    const { id } = req.params;
    const { songs = [], songIds = [] } = req.body || {};

    console.log("🎯 appendDeputyRepertoire()");
    console.log("   • deputyId:", id);
    console.log("   • songs.length:", Array.isArray(songs) ? songs.length : 0);
    console.log(
      "   • songIds.length:",
      Array.isArray(songIds) ? songIds.length : 0
    );

    const deputy = await musicianModel.findById(id);
    if (!deputy) {
      return res
        .status(404)
        .json({ success: false, message: "Deputy not found" });
    }

    // Normalize incoming songs to {title, artist, year, genre}
    const normalize = (s) => ({
      title: (s?.title || "").toString().trim(),
      artist: (s?.artist || "").toString().trim(),
      year: s?.year === "" || s?.year == null ? undefined : Number(s.year),
      genre: (s?.genre || "").toString().trim(),
    });

    let additions = [];

    if (Array.isArray(songs) && songs.length > 0) {
      additions = songs.map(normalize).filter((s) => s.title && s.artist);
    } else if (Array.isArray(songIds) && songIds.length > 0) {
      // Fallback: fetch from master list by ids, then map down to bare objects
      const master = await Song.find(
        { _id: { $in: songIds } },
        { title: 1, artist: 1, year: 1, genre: 1 }
      ).lean();
      additions = master.map(normalize).filter((s) => s.title && s.artist);
    } else {
      return res.status(400).json({
        success: false,
        message:
          "Provide either `songs` (array of objects) or `songIds` (array of ObjectIds).",
      });
    }

    // Build a dedupe set from existing deputy.repertoire
    const keyOf = (s) =>
      `${(s.title || "").trim().toLowerCase()}|${(s.artist || "")
        .trim()
        .toLowerCase()}|${s.year || ""}`;

    const existingKeys = new Set((deputy.repertoire || []).map(keyOf));
    const uniqueAdditions = additions.filter(
      (s) => !existingKeys.has(keyOf(s))
    );

    if (uniqueAdditions.length === 0) {
      return res.json({
        success: true,
        added: 0,
        total: deputy.repertoire.length,
        message: "No new songs to add (all duplicates).",
      });
    }

    deputy.repertoire = [...(deputy.repertoire || []), ...uniqueAdditions];
    deputy.markModified("repertoire");

    await deputy.save();

    console.log(
      `✅ Added ${uniqueAdditions.length} songs. New total: ${deputy.repertoire.length}`
    );

    return res.json({
      success: true,
      added: uniqueAdditions.length,
      total: deputy.repertoire.length,
      message: "Songs appended to deputy repertoire.",
    });
  } catch (err) {
    console.error("❌ appendDeputyRepertoire error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// exact/alias map for roles (extend as you learn real data)
const ROLE_ALIASES = {
  "band leader": ["musical director", "md"],
  "musical director": ["band leader", "md"],
  "dj with decks": [
    "dj",
    "dj with mixing console",
    "dj with console",
    "dj with controller",
  ],
  "dj with mixing console": ["dj", "dj with decks", "dj with controller"],
  "client liaison": ["client liason", "client-facing", "client facing"],
  "backing vocalist": ["backing vocals", "bv", "bv singer", "backing singer"],
  "lead vocalist": ["lead vocals", "lead singer"],
  rap: ["rapper", "mc", "emcee", "can rap", "mc/rapper"],
  "dj with decks": ["dj", "dj with mixing console", "dj with controller"],
  "sound engineering": [
    "sound engineer",
    "audio engineer",
    "foh",
    "front of house",
    "sound engineering with PA & lights provision",
  ],
};

const aliasSet = new Map(
  Object.entries(ROLE_ALIASES).map(([k, arr]) => [
    _norm(k),
    new Set(arr.map(_norm)),
  ])
);

const tokens = (s) =>
  _norm(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

// simple fuzzy: exact -> 1, alias -> 1, token Jaccard >= .5 -> 0.6, else 0
const roleSimilarity = (a, b) => {
  const A = _norm(a),
    B = _norm(b);
  if (!A || !B) return 0;

  if (A === B) return 1;

  // alias check both ways
  if (aliasSet.get(A)?.has(B) || aliasSet.get(B)?.has(A)) return 1;

  // token overlap
  const ta = new Set(tokens(A));
  const tb = new Set(tokens(B));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const jaccard = inter / (ta.size + tb.size - inter);
  return jaccard >= 0.5 ? 0.6 : 0;
};

// score desired (soft) roles with fuzzy similarity; returns [0..1]
const softRoleScore = (musician, desired = []) => {
  const skills = Array.isArray(musician?.other_skills)
    ? musician.other_skills.map(_norm)
    : [];
  if (!desired?.length || !skills.length) return 0;

  let total = 0;
  let denom = 0;

  for (const wantRaw of desired) {
    const want = _norm(wantRaw);
    if (!want) continue;

    // find best similarity among musician skills
    let best = 0;
    for (const have of skills) {
      const sim = roleSimilarity(have, want);
      if (sim > best) best = sim;
      if (best === 1) break;
    }

    // small bonus for key vocal-related desires if musician actually qualifies
    if (/backing/.test(want)) {
      const types = Array.isArray(musician?.vocals?.type)
        ? musician.vocals.type.map(_norm)
        : [];
      if (types.some((t) => /backing/.test(t))) best = Math.max(best, 1);
      else if (types.some((t) => /lead/.test(t))) best = Math.max(best, 0.8); // leads can usually provide BVs
    }
    if (/rap/.test(want)) {
      const rapVal = String(musician?.vocals?.rap ?? "").toLowerCase();
      const canRap = rapVal === "true" || rapVal === "yes";
      if (canRap) best = Math.max(best, 1);
    }

    total += best;
    denom += 1;
  }

  return denom ? total / denom : 0;
};

// --- controller ------------------------------------------------------------
// Canonicalise county keys to match POSTCODE_MAP keys
const _countyKey = (name = "") =>
  String(name).toLowerCase().replace(/\s+/g, "_");

// Return array of neighbouring counties: any county that shares at least one outward prefix
const neighboursForCounty = (countyName = "") => {
  const key = _countyKey(countyName);
  const mine = new Set(
    (POSTCODE_MAP[key] || []).map((s) => String(s).toUpperCase().trim())
  );
  if (!mine.size) return [];

  const out = new Set();
  for (const [cKey, prefixes] of Object.entries(POSTCODE_MAP)) {
    if (cKey === key) continue;
    const hasOverlap = (prefixes || []).some((p) =>
      mine.has(String(p).toUpperCase().trim())
    );
    if (hasOverlap) out.add(cKey);
  }
  return Array.from(out).map((k) => k.replace(/_/g, " ")); // back to display form
};

/* -------------------- main handler -------------------- */
const suggestDeputies = async (req, res) => {
  try {
    const {
      instrument = "",
      isVocalSlot = false,
      essentialRoles = [],
      desiredRoles = [],
      secondaryInstruments = [],
      excludeIds = [],
      actRepertoire = [],
      actGenres = [],
      originLocation = {}, // { county, postcode }
      limit = 24,
      debug = false,
    } = req.body || {};

    // Make logs easy to scan per request
    const reqTag = `[suggestDeputies:${Date.now().toString(36)}]`;

    // ----- helpers (local, safe) -----
    const _norm = (s) => (typeof s === "string" ? s.trim().toLowerCase() : "");
    const _safe = (v) => (v == null ? "" : String(v));

    const _instrumentLabels = (m) => {
      const fromInst = Array.isArray(m?.instrumentation)
        ? m.instrumentation
            .map((i) => (typeof i === "string" ? i : i?.instrument || ""))
            .filter(Boolean)
        : [];
      const fromInstruments = Array.isArray(m?.instruments)
        ? m.instruments
            .map((i) => (typeof i === "string" ? i : i?.instrument || ""))
            .filter(Boolean)
        : [];
      return [...fromInst, ...fromInstruments].map(_norm).filter(Boolean);
    };

    const _outward = (pc = "") =>
      String(pc).toUpperCase().replace(/\s+/g, "").slice(0, 3);

    const countyFromPostcode = (pc = "") => {
      const ow = _outward(pc);
      if (!ow) return "";
      for (const [county, districts] of Object.entries(POSTCODE_MAP)) {
        if (
          Array.isArray(districts) &&
          districts.some((d) => ow.startsWith(String(d).toUpperCase()))
        ) {
          return county.replace(/_/g, " ");
        }
      }
      return "";
    };

    // --- Title-only fuzzy matching --------------------------------------
    const _titleCore = (s = "") => {
      let t = String(s || "").toLowerCase();
      t = t.replace(/\([^)]*\)/g, " ");
      t = t.replace(/&/g, " and ");
      t = t.replace(/[^a-z0-9]+/g, " ");
      t = t.replace(/\bthe\b|\ba\b|\ban\b/g, " ");
      t = t.replace(/\s+/g, " ").trim();
      return t;
    };

    const _titleKey = (song) =>
      _titleCore(typeof song === "object" ? song?.title : song);

    const _titlesLooselyMatch = (aCore, bCore) => {
      if (!aCore || !bCore) return false;
      if (aCore === bCore) return true;
      if (aCore.length >= 3 && (aCore.includes(bCore) || bCore.includes(aCore)))
        return true;

      const ta = aCore.split(" ");
      const tb = bCore.split(" ");
      const dropOne = (arr) => {
        if (arr.length <= 1) return [""];
        const out = [];
        for (let i = 0; i < arr.length; i++) {
          out.push(
            arr
              .slice(0, i)
              .concat(arr.slice(i + 1))
              .join(" ")
          );
        }
        return out.map((s) => s.replace(/\s+/g, " ").trim());
      };

      const aDrop = new Set(dropOne(ta));
      const bDrop = new Set(dropOne(tb));
      if (aDrop.has(bCore) || bDrop.has(aCore)) return true;

      const A = new Set(ta),
        B = new Set(tb);
      let inter = 0;
      for (const t of A) if (B.has(t)) inter++;
      const jac = inter / (A.size + B.size - inter || 1);
      return jac >= 0.6;
    };

    const isVocalist = (m) => {
      const types = Array.isArray(m?.vocals?.type)
        ? m.vocals.type.map(_norm)
        : [];
      if (types.some((t) => /vocal|singer|rap|mc/.test(t))) return true;

      const inst = _instrumentLabels(m);
      if (inst.some((s) => /vocal|singer|rap|mc/.test(s))) return true;

      const rapVal = String(m?.vocals?.rap ?? "").toLowerCase();
      if (rapVal === "true" || rapVal === "yes") return true;

      const skills = Array.isArray(m?.other_skills)
        ? m.other_skills.map(_norm)
        : [];
      if (skills.some((s) => /backing\s*voc(al|als|alist)?|bv/.test(s)))
        return true;

      return false;
    };

    const _getOtherSkills = (m) =>
      (Array.isArray(m?.other_skills) ? m.other_skills : [])
        .map((s) =>
          typeof s === "string" ? s : s?.label || s?.name || s?.title || ""
        )
        .map(_norm)
        .filter(Boolean);

    const _hasAllRoles = (m, required = []) => {
      if (!required.length) return true;
      const skills = _getOtherSkills(m);
      return required.every((req) =>
        skills.some((have) => roleSimilarity(have, req) >= 0.6)
      );
    };

    const _matchesInstrument = (m, label) => {
      if (!label) return true;
      const Lraw = _norm(label);

      const canon = (s) => {
  let x = _norm(s);

  // vocals
  if (/lead.*vocal|vocalist|singer|rap|mc/.test(x)) return "vocal";

  // bass BEFORE guitar (so "bass guitar" doesn't become "guitar")
  if (/bass\s*guitar|bassist|electric\s*bass|acoustic\s*bass|\bbass\b/.test(x)) return "bass";

  // guitar (covers electric/acoustic/etc)
  if (/guitar/.test(x)) return "guitar";

  if (/keys|keyboard|piano/.test(x)) return "keyboard";
  if (/drum|cajon|percussion/.test(x)) return "drums";
  if (/sax/.test(x)) return "saxophone";
  if (/trumpet/.test(x)) return "trumpet";
  if (/trombone/.test(x)) return "trombone";

  return x;
};

      const L = canon(Lraw);
      const list = _instrumentLabels(m).map(canon);
      return list.some((i) => i.includes(L) || L.includes(i));
    };

    const hasAnyInstrument = (m, wanted) => {
      if (!wanted?.length) return true;
    const canon = (s) => {
  let x = _norm(s);

  if (/lead.*vocal|vocalist|singer|rap|mc/.test(x)) return "vocal";

  // bass BEFORE guitar
  if (/bass\s*guitar|bassist|electric\s*bass|acoustic\s*bass|\bbass\b/.test(x)) return "bass";

  if (/guitar/.test(x)) return "guitar";

  if (/keys|keyboard|piano/.test(x)) return "keyboard";
  if (/drum|cajon|percussion/.test(x)) return "drums";
  if (/sax/.test(x)) return "saxophone";
  if (/trumpet/.test(x)) return "trumpet";
  if (/trombone/.test(x)) return "trombone";

  return x;
};

const labels = _instrumentLabels(m).map(canon);
return wanted.map(canon).some((w) => labels.includes(w));
    };

    const ROLE_ALIASES = {
      "band management": ["manager", "md", "musical director"],
      "sound engineering": [
        "sound engineer",
        "engineer",
        "audio tech",
        "foh",
        "sound engineering with PA & light provision",
      ],
      "backing vocals": ["backing vocalist", "bv", "backing singer"],
      "lead vocals": ["lead singer"],
      dj: ["disc jockey", "deejay"],
      rap: ["rapper", "mc", "emcee"],
    };

    const expandDesiredRoles = (arr = []) => {
      const out = new Set();
      arr.forEach((r) => {
        const k = _norm(r);
        if (!k) return;
        out.add(k);
        (ROLE_ALIASES[k] || []).forEach((a) => out.add(_norm(a)));
      });
      return out;
    };

    const computeGenreFit = (act, dep) => {
      const A = new Set((act || []).map(_norm).filter(Boolean));
      const D = new Set((dep || []).map(_norm).filter(Boolean));
      if (!A.size) return 0;
      let inter = 0;
      for (const g of A) if (D.has(g)) inter++;
      return inter / A.size;
    };

    const scoreLocation = ({
      originCounty,
      originPostcode,
      deputyCounty,
      deputyPostcode,
      originNeighbours = [],
    }) => {
      const oc = _norm(originCounty),
        dc = _norm(deputyCounty);

      if (oc && dc && oc === dc) return 1;
      if (originNeighbours.some((n) => _norm(n) === dc)) return 0.8;

      const op = _safe(originPostcode).toUpperCase();
      const dp = _safe(deputyPostcode).toUpperCase();
      if (op && dp && op.slice(0, 2) === dp.slice(0, 2)) return 0.6;

      return 0;
    };

    // ----- normalize inputs -----
    const requiredRoles = (Array.isArray(essentialRoles) ? essentialRoles : [])
      .map(_norm)
      .filter(Boolean);

    let inferredSecondaries = [];
    if (!Array.isArray(secondaryInstruments) || !secondaryInstruments.length) {
      const slot = _norm(instrument);
      const maybe = [];
      if (/guitar/.test(slot)) maybe.push("guitar");
      if (/\bbass\b|bassist/.test(slot)) maybe.push("bass");
      if (/keys|keyboard|piano/.test(slot)) maybe.push("keyboard");
      if (/sax/.test(slot)) maybe.push("saxophone");
      if (/trumpet/.test(slot)) maybe.push("trumpet");
      if (/trombone/.test(slot)) maybe.push("trombone");
      if (/drum|cajon|percussion/.test(slot)) maybe.push("drums");
      inferredSecondaries = maybe;
    }

    const wantedSecondaries =
      Array.isArray(secondaryInstruments) && secondaryInstruments.length
        ? secondaryInstruments.map(_norm)
        : inferredSecondaries;

    const desiredRoleSet = expandDesiredRoles(
      Array.isArray(desiredRoles) ? desiredRoles : []
    );

    const actTitleKeys = new Set(
      (Array.isArray(actRepertoire) ? actRepertoire : [])
        .map(_titleKey)
        .filter(Boolean)
    );

    if (debug) {
      console.log(`${reqTag} 🔍 request`, {
        instrument,
        isVocalSlot,
        requiredRoles,
        desiredRolesCount: Array.isArray(desiredRoles) ? desiredRoles.length : 0,
        wantedSecondaries,
        excludeIdsCount: Array.isArray(excludeIds) ? excludeIds.length : 0,
        actRepertoireCount: Array.isArray(actRepertoire) ? actRepertoire.length : 0,
        actTitleKeysCount: actTitleKeys.size,
        actGenres,
        originLocation,
        limit,
      });
    }

    // ----- fetch pool -----
    const baseFilter = {
      role: "musician",
      status: { $in: ["approved", "Approved, changes pending"] },
      ...(excludeIds?.length ? { _id: { $nin: excludeIds } } : {}),
    };

    const pool = await musicianModel
      .find(baseFilter, {
        firstName: 1,
        lastName: 1,
        email: 1,
        phone: 1,
        phoneNumber: 1,

        // ✅ Image fields (support schema drift)
        profilePicture: 1,
        profilePhoto: 1,
        profileImage: 1,
        profilePic: 1,
        profile_picture: 1,
        additionalImages: 1,

        instrumentation: 1,
        instruments: 1,
        vocals: 1,
        other_skills: 1,
        address: 1,
        repertoire: 1,
        selectedSongs: 1,
        genres: 1,
      })
      .limit(300)
      .lean();

    if (debug) {
      const imgStats = {
        pool: pool.length,
        has_profilePicture: 0,
        has_profilePhoto: 0,
        has_profileImage: 0,
        has_profilePic: 0,
        has_profile_picture: 0,
        has_additional0: 0,
      };

      for (const m of pool) {
        if (m?.profilePicture) imgStats.has_profilePicture++;
        if (m?.profilePhoto) imgStats.has_profilePhoto++;
        if (m?.profileImage) imgStats.has_profileImage++;
        if (m?.profilePic) imgStats.has_profilePic++;
        if (m?.profile_picture) imgStats.has_profile_picture++;
        if (Array.isArray(m?.additionalImages) && m.additionalImages[0])
          imgStats.has_additional0++;
      }

      console.log(`${reqTag} 🖼️ image field stats`, imgStats);
    }

    let passRoles = 0,
      passVocal = 0,
      passInst = 0,
      passSec = 0,
      pushed = 0;

    const out = [];
    let missingPicLogged = 0;

    for (const m of pool) {
      // HARD gates
      if (!_hasAllRoles(m, requiredRoles)) continue;
      passRoles++;

      if (isVocalSlot) {
        if (!isVocalist(m)) continue;
        passVocal++;
      } else {
        if (!_matchesInstrument(m, instrument)) continue;
        passInst++;
      }

      if (wantedSecondaries.length && !hasAnyInstrument(m, wantedSecondaries))
        continue;
      passSec++;

      // ---------- Repertoire overlap (TITLE-ONLY fuzzy)
      const depTitleKeysArr = [
        ...(Array.isArray(m.repertoire) ? m.repertoire : []),
        ...(Array.isArray(m.selectedSongs) ? m.selectedSongs : []),
      ]
        .map(_titleKey)
        .filter(Boolean);

      let overlap = 0;
      if (actTitleKeys.size && depTitleKeysArr.length) {
        const depExact = new Set(depTitleKeysArr);
        for (const k of actTitleKeys) if (depExact.has(k)) overlap++;
        if (overlap < actTitleKeys.size) {
          const depArr = Array.from(depExact);
          for (const ak of actTitleKeys) {
            if (depExact.has(ak)) continue;
            if (depArr.some((dk) => _titlesLooselyMatch(ak, dk))) overlap++;
          }
        }
      }
      const songOverlapPct = actTitleKeys.size
        ? overlap / actTitleKeys.size
        : 0;

      // ---------- Location score
      const originCountyRaw =
        _safe(originLocation?.county) ||
        countyFromPostcode(_safe(originLocation?.postcode));
      const originPostcode = _safe(originLocation?.postcode);

      const originNeighbourCounties = neighboursForCounty(originCountyRaw);

      const deputyCountyRaw =
        _safe(m?.address?.county || m?.county) ||
        countyFromPostcode(_safe(m?.address?.postcode || m?.postcode));
      const deputyPostcode = _safe(m?.address?.postcode || m?.postcode);

      const locScore = scoreLocation({
        originCounty: originCountyRaw,
        originPostcode,
        deputyCounty: deputyCountyRaw,
        deputyPostcode,
        originNeighbours: originNeighbourCounties,
      });

      // ---------- Genres
      const vocalGenres = Array.isArray(m?.vocals?.genres)
        ? m.vocals.genres
        : typeof m?.vocals?.genres === "string"
        ? m.vocals.genres.split(",").map((s) => s.trim())
        : [];

      const topGenres = Array.isArray(m?.genres)
        ? m.genres
        : typeof m?.genres === "string"
        ? m.genres.split(",").map((s) => s.trim())
        : [];

      const depGenres = topGenres.length ? topGenres : vocalGenres;
      const genreFit = computeGenreFit(actGenres, depGenres);

      // ---------- Weights & score
      let wSongs = 0.75;
      let wRoles = desiredRoleSet.size ? 0.1 : 0;
      let wGenre = actGenres?.length ? 0.05 : 0;
      let wLoc = 0.1;
      const wSum = wSongs + wRoles + wGenre + wLoc;
      wSongs /= wSum;
      wRoles /= wSum;
      wGenre /= wSum;
      wLoc /= wSum;

      const roleFit = 0;
      const rawScore =
        wSongs * songOverlapPct +
        wRoles * roleFit +
        wGenre * genreFit +
        wLoc * locScore;
      const matchPct = Math.round(Math.max(0, Math.min(1, rawScore)) * 100);

      // ✅ Resolve image with fallbacks (this is the key fix)
      const resolvedProfilePicture =
        m?.profilePicture ||
        m?.profilePhoto ||
        m?.profileImage ||
        m?.profilePic ||
        m?.profile_picture ||
        (Array.isArray(m?.additionalImages) ? m.additionalImages[0] : "") ||
        "";

      if (debug && !resolvedProfilePicture && missingPicLogged < 12) {
        missingPicLogged++;
        console.log(`${reqTag} ❌ missing pic`, {
          id: String(m._id),
          name: `${m.firstName || ""} ${m.lastName || ""}`.trim(),
          profilePicture: m?.profilePicture,
          profilePhoto: m?.profilePhoto,
          profileImage: m?.profileImage,
          profilePic: m?.profilePic,
          profile_picture: m?.profile_picture,
          additional0: Array.isArray(m?.additionalImages) ? m.additionalImages[0] : undefined,
        });
      }

      const item = {
        id: String(m._id),
        _id: m._id,

        email: m.email,
        firstName: m.firstName,
        lastName: m.lastName,

        phoneNumber: m.phoneNumber || m.phone || "",

        // ✅ always give the UI the resolved URL in the field it expects
        profilePicture: resolvedProfilePicture,
        // optional: keep raw fields for debugging / future migrations
        profilePhoto: m?.profilePhoto,
        additionalImages: Array.isArray(m.additionalImages) ? m.additionalImages : [],

        address: m.address || {},
        repertoire: Array.isArray(m.repertoire) ? m.repertoire : [],
        selectedSongs: Array.isArray(m.selectedSongs) ? m.selectedSongs : [],
        genres: depGenres,
        vocals: { ...(m.vocals || {}), genres: vocalGenres },
        other_skills: Array.isArray(m.other_skills) ? m.other_skills : [],
        matchPct,
      };

      if (debug) {
        item._debug = {
          actCount: actTitleKeys.size,
          depCount: depTitleKeysArr.length,
          overlapCount: overlap,
          songOverlapPct,
          genreFit,
          locScore,
          originLoc: { county: originCountyRaw, postcode: originPostcode },
          deputyLoc: { county: deputyCountyRaw, postcode: deputyPostcode },
          weights: { songs: wSongs, roles: wRoles, genre: wGenre, location: wLoc },
        };
      }

      out.push(item);
      pushed++;
    }

    if (debug) {
      console.log(`${reqTag} ✅ gates`, { passRoles, passVocal, passInst, passSec, pushed });
    }

    out.sort(
      (a, b) =>
        b.matchPct - a.matchPct ||
        (a.lastName || "").localeCompare(b.lastName || "")
    );

    return res.json({
      success: true,
      musicians: out.slice(0, Math.max(1, parseInt(limit, 10) || 24)),
    });
  } catch (err) {
    console.error("❌ suggestDeputies error:", err);
    return res
      .status(200)
      .json({ success: false, musicians: [], message: "Server error (safe)" });
  }
};

export {
  listActs,
  suggestDeputies,
  appendDeputyRepertoire,
  addAct,
  removeAct,
  singleAct,
  emailContract,
  updateActStatus,
  registerMusician,
  loginMusician,
  saveActDraft,
  saveAmendmentDraft,
  getMyDrafts,
  approveAmendment,
  registerDeputy,
  listPendingDeputies,
  rejectDeputy,
  approveDeputy,
  updateAct,
  rejectAct,
  refreshAccessToken,
  logoutMusician,
  getDeputyById,
};
