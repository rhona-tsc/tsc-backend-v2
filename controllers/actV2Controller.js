import mongoose from "mongoose";
import actModel from "../models/actModel.js"
import { upsertActCardFromAct } from "./helpers/upsertActCardFromAct.js";
import util from "util";

// Treat numbers (0), booleans (false), and Date as meaningful.
// Treat "", [], {} as empty; treat null/undefined as empty.
const isMeaningful = (v) => {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Date) return true;
  if (typeof v === "object") return Object.keys(v).length > 0;
  if (typeof v === "number") return true;  // 0 is meaningful
  if (typeof v === "boolean") return true; // false is meaningful
  return true;
};

const hasDeputiesAnywhere = (obj) => {
  try {
    const lineups = obj?.lineups;
    if (!Array.isArray(lineups)) return false;
    return lineups.some((l) =>
      Array.isArray(l?.bandMembers) &&
      l.bandMembers.some((m) => Array.isArray(m?.deputies) && m.deputies.length >= 0)
    );
  } catch {
    return false;
  }
};

const findSetKeysContaining = (setObj, needle = "deputies") => {
  if (!setObj || typeof setObj !== "object") return [];
  return Object.keys(setObj).filter((k) => k.toLowerCase().includes(needle.toLowerCase()));
};

// Build a flat $set object from a (possibly nested) payload,
// skipping empty values for non-destructive autosave updates.
const buildSetDoc = (obj, prefix = "", out = {}) => {
  for (const [k, val] of Object.entries(obj || {})) {
    const path = prefix ? `${prefix}.${k}` : k;

    // do not let caller accidentally replace _id
    if (path === "_id") continue;

    // Allow explicit clearing only via clearKeys/clearAll (handled separately)
    if (!isMeaningful(val)) continue;

    if (typeof val === "object" && !Array.isArray(val) && !(val instanceof Date)) {
      // Recurse objects; if empty it would have been skipped above
      buildSetDoc(val, path, out);
    } else {
      out[path] = val;
    }
  }
  return out;
};

// Helper to validate ObjectIds
const isValidObjectId = (v) => mongoose.isValidObjectId(String(v || ""));

export const updateActV2 = async (req, res) => {
  try {
    const actId = req.params.id;
    if (!actId) {
      return res.status(400).json({ error: "Missing act ID" });
    }

    const existingAct = await actModel.findById(actId);
    if (!existingAct) {
      return res.status(404).json({ error: "Act not found" });
    }

    const incoming = req.body || {};

    console.log("🧪 updateActV2 incoming has lineups?", Array.isArray(incoming.lineups));
console.log("🧪 updateActV2 incoming has deputies anywhere?", hasDeputiesAnywhere(incoming));

if (Array.isArray(incoming.lineups) && incoming.lineups[0]?.bandMembers?.[0]) {
  console.log("🧪 sample incoming deputies[0]:", incoming.lineups[0].bandMembers[0].deputies?.[0]);
}

    const isSubmit = incoming.submit === true || incoming.submit === "true";

    let nextStatus = existingAct.status;
    if (isSubmit) {
      const wasApproved = existingAct.status === "approved" || existingAct.status === "live";
      nextStatus = wasApproved ? "Approved, changes pending" : "pending";
    }

    const clearKeys = Array.isArray(incoming.clearKeys) ? incoming.clearKeys : [];
    const $unset = clearKeys.reduce((acc, path) => {
      acc[path] = "";
      return acc;
    }, {});

    const $set = buildSetDoc(incoming);

    const deputySetKeys = findSetKeysContaining($set, "deputies");
console.log("🧪 buildSetDoc produced deputies keys:", deputySetKeys);

// helpful: confirm whether you're setting whole lineups vs dotted paths
console.log("🧪 buildSetDoc sets 'lineups' directly?", Object.prototype.hasOwnProperty.call($set, "lineups"));

    // Guard immutable/ownerish fields
    delete $set.createdBy;
    delete $set.createdByRole;
    delete $set.owner;
    delete $set.ownerId;
    delete $set.registeredBy;
    delete $set.userId;
    delete $set.musicianId;
    delete $set.owners;

    $set.status = nextStatus; // authoritative status

    const updatedAct = await actModel.findByIdAndUpdate(
      actId,
      Object.keys($unset).length ? { $set, $unset } : { $set },
      { new: true, runValidators: true }
    );

    console.log("✅ updateActV2 updatedAct has deputies anywhere?", hasDeputiesAnywhere(updatedAct));
if (updatedAct?.lineups?.[0]?.bandMembers?.[0]) {
  console.log("✅ sample saved deputies[0]:", updatedAct.lineups[0].bandMembers[0].deputies?.[0]);
}

    if (!updatedAct) {
      return res.status(404).json({ error: "Act not found" });
    }

    // 🔄 Keep card in sync
    try { await upsertActCardFromAct(updatedAct); } catch (e) {
      console.warn("⚠️ Card upsert after update failed:", e.message);
    }

    res.status(200).json({ message: "Act updated successfully", act: updatedAct });
  } catch (error) {
    console.error("❌ Error updating act:", error);
    res.status(500).json({ error: "Failed to update act" });
  }
};
  

export const createActV2 = async (req, res) => {
  try {
    console.log("Creating Act V2 with data:", req.body);

    const data = req.body || {};

    // Never trust client-sent ownership fields
    const cleaned = { ...data };
    delete cleaned.createdBy;
    delete cleaned.createdByRole;
    delete cleaned.createdByEmail;
    delete cleaned.createdByName;
    delete cleaned.owner;
    delete cleaned.ownerId;
    delete cleaned.registeredBy;
    delete cleaned.userId;
    delete cleaned.musicianId;
    delete cleaned.owners;

    // Resolve auth identity (must be an ObjectId for createdBy)
    const headerUserId = req.headers.userid || req.headers.userId || null;
    const candidateId = req.user?.id || req.user?._id || headerUserId || null;
    const authUserId = isValidObjectId(candidateId) ? String(candidateId) : null;

    const authUserRole = req.user?.role || req.headers.userrole || null;
    const authUserEmail = req.user?.email || req.headers.useremail || null;
    const authUserName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim();

    console.log("🔦 Creating act with lightingSystem:", cleaned.lightingSystem);
    console.log("📜 Creating act with setlist:", cleaned.setlist);
console.log("🧾 auth check", {
  hasReqUser: !!req.user,
  reqUser: req.user,
  useridHeader: req.headers.userid,
});
    // If we can't identify the creator as an ObjectId, fail fast.
    // This prevents accidental saving of an email into createdBy.
    if (!authUserId) {
      console.warn("🚫 createActV2 blocked: missing/invalid auth user id", {
        candidateId,
        headerUserId,
        decoded: req.user
          ? { id: req.user.id, _id: req.user._id, role: req.user.role, email: req.user.email }
          : null,
      });
      return res.status(401).json({
        success: false,
        message: "Unauthorized: missing or invalid user id for createdBy",
      });
    }

    // Status: allow draft/pending etc from client, but default to pending
    const finalStatus = cleaned.status || "pending";
    console.log("📌 Final status before save:", finalStatus);

    const newAct = new actModel({
      ...cleaned,
      status: finalStatus,
      createdBy: authUserId,
      ...(authUserRole ? { createdByRole: authUserRole } : {}),
      ...(authUserEmail ? { createdByEmail: authUserEmail } : {}),
      ...(authUserName ? { createdByName: authUserName } : {}),
    });

    await newAct.save();

    // 🔄 Upsert/refresh the lightweight card row
    try {
      await upsertActCardFromAct(newAct);
    } catch (e) {
      console.warn("⚠️ Card upsert after create failed:", e.message);
    }

    return res
      .status(201)
      .json({ success: true, message: "Act created", id: newAct._id });
  } catch (err) {
    console.error("❌ Failed to create act:", err);
    return res
      .status(500)
      .json({ success: false, error: "Failed to create act", details: err.message });
  }
};

  export const getActByIdV2 = async (req, res) => {
      const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ success: false, error: "invalid_object_id" });
  }
  
    try {
      const actId = req.params.id;
  
      const act = await actModel.findById(actId);
  
      if (!act) {
        return res.status(404).json({ error: "Act not found" });
      }
  
      res.status(200).json(act);
    } catch (err) {
      console.error("❌ Error fetching act:", err);
      res.status(500).json({ error: "Failed to fetch act" });
    }
  };


export const saveActDraftV2 = async (req, res) => {
  try {
    const data = req.body || {};
    const status = "draft"; // force draft on autosave

    if (data._id) {
      const existing = await actModel.findById(data._id);
      if (!existing) {
        return res.status(404).json({ error: "Draft not found to update" });
      }

      console.log("🧪 saveActDraftV2 incoming has lineups?", Array.isArray(data.lineups));
console.log("🧪 saveActDraftV2 incoming has deputies anywhere?", hasDeputiesAnywhere(data));
if (Array.isArray(data.lineups) && data.lineups[0]?.bandMembers?.[0]) {
  console.log("🧪 draft sample incoming deputies[0]:", data.lineups[0].bandMembers[0].deputies?.[0]);
}

      const $set = buildSetDoc(data);

      const deputySetKeys = findSetKeysContaining($set, "deputies");
console.log("🧪 draft buildSetDoc produced deputies keys:", deputySetKeys);
console.log("🧪 draft buildSetDoc sets 'lineups' directly?", Object.prototype.hasOwnProperty.call($set, "lineups"));

      $set.status = status;

      const clearKeys = Array.isArray(data.clearKeys) ? data.clearKeys : [];
      const $unset = clearKeys.reduce((acc, path) => {
        acc[path] = "";
        return acc;
      }, {});

      const updated = await actModel.findByIdAndUpdate(
        data._id,
        Object.keys($unset).length ? { $set, $unset } : { $set },
        { new: true }
      );

      console.log("✅ draft updated has deputies anywhere?", hasDeputiesAnywhere(updated));
if (updated?.lineups?.[0]?.bandMembers?.[0]) {
  console.log("✅ draft sample saved deputies[0]:", updated.lineups[0].bandMembers[0].deputies?.[0]);
}

      // 🔄 Keep card table consistent (service should ignore drafts if that’s your rule)
      try { await upsertActCardFromAct(updated); } catch (e) {
        console.warn("⚠️ Card upsert after draft update failed:", e.message);
      }

      return res.status(200).json({ message: "Draft updated", _id: updated._id });
    } else {
      // Creating a new draft
      const headerUserId = req.headers.userid || req.headers.userId || null;
      const candidateId = req.user?.id || req.user?._id || headerUserId || null;
      const authUserId = isValidObjectId(candidateId) ? String(candidateId) : null;

      const toCreate = {
        ...data,
        status,
        ...(authUserId ? { createdBy: authUserId } : {}),
        ...(req.user?.role ? { createdByRole: req.user.role } : {}),
        ...(req.user?.email ? { createdByEmail: req.user.email } : {}),
        ...((req.user?.firstName || req.user?.lastName)
          ? { createdByName: `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() }
          : {}),
      };

      // Never trust client-sent ownership fields
      delete toCreate.owner;
      delete toCreate.ownerId;
      delete toCreate.registeredBy;
      delete toCreate.userId;
      delete toCreate.musicianId;
      delete toCreate.owners;

      const doc = new actModel(toCreate);
      await doc.save();

      // 🔄 Card upsert (likely a no-op for draft)
      try { await upsertActCardFromAct(doc); } catch (e) {
        console.warn("⚠️ Card upsert after draft create failed:", e.message);
      }

      return res.status(201).json({ message: "Draft created", _id: doc._id });
    }
  } catch (err) {
    console.error("❌ Failed to save act draft:", err);
    res.status(500).json({ error: "Failed to save act draft", details: err.message });
  }
};


// allow-list of safe fields to return
// Add these fields to ALLOWED_FIELDS
const ALLOWED_FIELDS = new Set([
  "_id",
  "name",
  "tscName",
  "images",
  "coverImage",
  "createdAt",
  "updatedAt",
  "status",
  "amendment",
  // 👇 Add these
  "numberOfSets",
  "lengthOfSets",
  "minimumIntervalLength",
  "lineups",
  "extras",
  "paSystem",
  "lightingSystem",
  "base_fee",
  "bio",
  "description",
]);

const sanitizeFields = (fieldsStr = "") => {
  if (!fieldsStr) return null;
  const fields = fieldsStr
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f && ALLOWED_FIELDS.has(f));
  if (!fields.length) return null;
  return fields.reduce((acc, f) => { acc[f] = 1; return acc; }, {});
};

const parseStatuses = (statusStr = "") => {
  if (!statusStr) return null;
  const raw = statusStr.split(",").map((s) => s.trim()).filter(Boolean);
  // re-join your special “Approved, changes pending”
  const merged = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    if (s.toLowerCase() === "approved" && raw[i + 1]?.toLowerCase() === "changes pending") {
      merged.push("Approved, changes pending"); i++;
    } else {
      merged.push(s);
    }
  }
  return Array.from(new Set(merged));
};



export const getAllActsV2 = async (req, res) => {
  /* ───────────────────────── DEBUG HELPERS ───────────────────────── */
  const now = () => new Date().toISOString();
  const p = (obj, depth = 6) => {
    try { return util.inspect(obj, { depth, colors: false, maxArrayLength: 200 }); }
    catch { return String(obj); }
  };
  const group = (label) => { try { console.groupCollapsed(label); } catch {} };
  const end = () => { try { console.groupEnd(); } catch {} };
  const dbg = (...args) => console.log("🧭 [getAllActsV2]", ...args);

  dbg(`⚡ start ${now()}`);
  group("📥 Incoming request snapshot");
  dbg("method:", req.method);
  dbg("url:", req.originalUrl || req.url);
  dbg("ip:", req.ip);
  dbg("headers (subset):", p({
    host: req.headers.host,
    "user-agent": req.headers["user-agent"],
    userid: req.headers.userid,
    userrole: req.headers.userrole,
    "x-scope": req.headers["x-scope"],
  }));
  dbg("query raw:", p(req.query));
  end();

  const T0 = Date.now();
  try {
    const {
      status = "",
      fields = "",
      sort = "-createdAt",
      limit = "50",
      page = "1",
      includeTrashed = "false",
      q = "",
    } = req.query;

    const authUserId   = req.user?.id || req.user?._id || req.headers.userid || null;
    const authUserRole = req.user?.role || req.headers.userrole || null;
    const mineFlag =
      String(req.query.mine || req.headers["x-scope"] || "").toLowerCase() === "mine" ||
      String(req.query.authorId || "").length > 0;

    const lim  = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const pg   = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (pg - 1) * lim;

    group("🧮 Parsed params");
    dbg("status:", status);
    dbg("fields:", fields || "(default projection)");
    dbg("sort:", sort);
    dbg("limit:", lim, "page:", pg, "skip:", skip);
    dbg("includeTrashed:", includeTrashed);
    dbg("search q:", q);
    dbg("authUserId:", authUserId, "authUserRole:", authUserRole, "mineFlag:", mineFlag);
    end();

    /* ── Projection (include BOTH genre + genres for safety) ── */
    const projection =
      sanitizeFields(fields) || {
        _id: 1,
        name: 1,
        tscName: 1,
        status: 1,
        createdAt: 1,
        numberOfSets: 1,
        lengthOfSets: 1,
        minimumIntervalLength: 1,
        "coverImage.url": 1,
        "images.url": 1,
        "profileImage.url": 1,
        "lineups.base_fee": 1,
        genre: 1,          // singular field
        genres: 1,         // ← plural (present in some docs)
      };

    group("🧾 Projection in use");
    dbg(p(projection));
    end();

    /* ── Filter building ── */
    const filter = {};
    if (includeTrashed !== "true") filter.status = { $ne: "trashed" };

    group("🎛️ Status & special status parsing");
    const rawTokens  = String(status || "").split(",").map(s => s.trim()).filter(Boolean);
    const tokensLC   = rawTokens.map(s => s.toLowerCase());
    dbg("rawTokens:", rawTokens);
    dbg("tokensLC:", tokensLC);

    const wantsApprovedChangesPending =
      tokensLC.includes("approved_changes_pending") ||
      tokensLC.includes("approved (changes pending)") ||
      tokensLC.includes("approved, changes pending") ||
      (tokensLC.includes("approved") && tokensLC.includes("changes pending"));

    const allowed    = new Set(["approved", "pending", "draft", "trashed", "rejected"]);
    const isSentinel = (s) =>
      /^approved(_|\s*\(|,\s*)changes\s*pending\)?$/i.test(s) ||
      s.toLowerCase() === "changes pending";

    const normalStatuses = rawTokens
      .filter(s => !isSentinel(s))
      .map(s => s.toLowerCase())
      .filter(s => allowed.has(s));

    dbg("normalStatuses:", normalStatuses);
    dbg("wantsApprovedChangesPending:", wantsApprovedChangesPending);

    if (normalStatuses.length) {
      if (filter.status) {
        filter.$and = [{ status: filter.status }, { status: { $in: normalStatuses } }];
        delete filter.status;
      } else {
        filter.status = { $in: normalStatuses };
      }
    }

    if (wantsApprovedChangesPending) {
      const specialClause = { $and: [{ status: "approved" }, { "amendment.isPending": true }] };
      if (filter.$or) {
        filter.$or.push(specialClause);
      } else {
        if (filter.status) {
          const existing = { status: filter.status };
          delete filter.status;
          filter.$or = [existing, specialClause];
        } else if (filter.$and) {
          filter.$or = [specialClause];
        } else {
          filter.$or = [specialClause];
        }
      }
    }
    dbg("filter after statuses:", p(filter));
    end();

    /* ── Text search ── */
    if (q.trim()) {
      const re = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      if (filter.$or) {
        filter.$and = filter.$and || [];
        filter.$and.push({ $or: [{ name: re }, { tscName: re }] });
      } else {
        filter.$or = [{ name: re }, { tscName: re }];
      }
      dbg("added regex:", String(re));
    }
    dbg("filter after search:", p(filter));

    /* ── Ownership gating ── */
    group("👤 Ownership gating");
    if (authUserRole === "musician") {
      if (!authUserId) {
        dbg("❗ musician role without user id → 401");
        return res.status(401).json({ success: false, message: "Unauthorized: Missing user id" });
      }
      const uid   = String(authUserId);
      const ownOr = [
        { createdBy: uid }, { owner: uid }, { ownerId: uid },
        { registeredBy: uid }, { userId: uid }, { musicianId: uid }, { owners: uid },
      ];
      if (filter.$or) {
        filter.$and = filter.$and || [];
        filter.$and.push({ $or: ownOr });
      } else {
        filter.$or = ownOr;
      }
      dbg("applied musician ownership:", p({ uid }));
    } else if (mineFlag) {
      const uid = String(req.query.authorId || authUserId || "");
      if (uid) {
        const mineOr = [
          { createdBy: uid }, { owner: uid }, { ownerId: uid },
          { registeredBy: uid }, { userId: uid }, { musicianId: uid }, { owners: uid },
        ];
        if (filter.$or) {
          filter.$and = filter.$and || [];
          filter.$and.push({ $or: mineOr });
        } else {
          filter.$or = mineOr;
        }
        dbg("applied mineFlag ownership:", p({ uid }));
      } else {
        dbg("mineFlag true but no uid available");
      }
    }
    if (req.query.authorId) {
      const authorId = String(req.query.authorId);
      const ownershipConditions = [
        { createdBy: authorId }, { owner: authorId }, { ownerId: authorId },
        { registeredBy: authorId }, { userId: authorId }, { musicianId: authorId }, { owners: authorId },
      ];
      if (filter.$or) {
        filter.$and = filter.$and || [];
        filter.$and.push({ $or: ownershipConditions });
      } else {
        filter.$or = ownershipConditions;
      }
      dbg("explicit authorId ownership:", authorId);
    }
    end();

    group("🧩 FINAL Mongo params");
    dbg("filter:", p(filter));
    dbg("projection:", p(projection));
    dbg("sort/skip/limit:", { sort, skip, lim });
    end();

    /* ── DB fetch ── */
    const Tdb0 = Date.now();
    let total = 0, actsRaw = [];
    try {
      [total, actsRaw] = await Promise.all([
        actModel.countDocuments(filter),
        actModel.find(filter, projection).sort(sort).skip(skip).limit(lim).lean(),
      ]);
    } catch (dbErr) {
      dbg("❌ DB error during count/find:", dbErr?.message || dbErr);
      throw dbErr;
    }
    const Tdb1 = Date.now();
    dbg(`📊 DB timings: ${Tdb1 - Tdb0}ms (count + find in parallel)`);
    dbg("📦 total matches:", total, "returned:", actsRaw.length);
    dbg("🔑 keys of first raw doc:", actsRaw[0] ? Object.keys(actsRaw[0]) : "(none)");

    /* ── Build items + genre diagnostics ── */
    const items = actsRaw.map((doc) => {
      const cardImage =
        doc?.coverImage?.[0]?.url ||
        doc?.images?.[0]?.url ||
        doc?.profileImage?.[0]?.url ||
        "";
      // unify genres
      const genresArr =
        Array.isArray(doc?.genres) ? doc.genres
        : Array.isArray(doc?.genre) ? doc.genre
        : typeof doc?.genre === "string" ? [doc.genre]
        : [];
      return { ...doc, cardImage, genres: genresArr };
    });

    group("🔎 Sample rows (up to 10)");
    console.table(
      items.slice(0, 10).map((d, i) => ({
        i,
        id: String(d._id || ""),
        name: d.tscName || d.name || "(untitled)",
        status: d.status,
        genres: (d.genres || []).join(" | "),
        cardImage: d.cardImage ? "yes" : "no",
        lineupsCount: Array.isArray(d.lineups) ? d.lineups.length : 0,
      }))
    );
    end();

    // quick genre stats
    const allGenres = items.flatMap((d) => Array.isArray(d.genres) ? d.genres : []);
    const genreCounts = allGenres.reduce((acc, g) => {
      const key = String(g).trim();
      if (!key) return acc;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    group("🎼 Genre stats");
    dbg("unique genres:", Object.keys(genreCounts).length);
    console.table(
      Object.entries(genreCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([g, n]) => ({ genre: g, count: n }))
        .slice(0, 30)
    );
    end();

    const totalPages = Math.ceil(total / lim);
    const Tend = Date.now();
    dbg(`✅ success ${now()} • total=${total} page=${pg}/${totalPages} returned=${items.length} • ${Tend - T0}ms`);

    // Dual shape for compatibility
    res.json({
      success: true,
      items,
      acts: items,
      total,
      page: pg,
      limit: lim,
      totalPages,
      count: items.length,
    });
  } catch (err) {
    const Tend = Date.now();
    console.error("❌ Error in getAllActsV2:", err?.stack || err);
    console.error("⏱️ elapsed:", Tend - T0, "ms");
    res.status(500).json({ success: false, message: "Failed to fetch acts" });
  }
};

  
  export const getMyDrafts = async (req, res) => {
    try {
      const userId = req.user?.id || req.headers.userid || null;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized: Missing user ID" });
      }
  
      const drafts = await actModel.find({
        status: "draft",
        createdBy: userId, // ✅ make sure this field is stored on act creation
      });
  
      res.status(200).json({ drafts });
    } catch (err) {
      console.error("❌ Error fetching drafts:", err);
      res.status(500).json({ error: "Failed to fetch drafts" });
    }
  };

  export const getModerationCount = async (req, res) => {
    try {
      const count = await actModel.countDocuments({
        $or: [
          { status: "pending" },
          { status: "Approved, changes pending", pendingChanges: { $ne: null } }
        ]
      });

      res.status(200).json({ success: true, count });
    } catch (err) {
      console.error("❌ Error counting moderation acts:", err);
      res.status(500).json({ error: "Failed to count moderation acts" });
    }
  };

export const updateActStatus = async (req, res) => {
  try {
    const { id, status } = req.body;
    console.log("🔧 Updating act status:", id, status);

    const act = await actModel.findById(id);
    if (!act) {
      console.log("❌ Act not found:", id);
      return res.status(404).json({ success: false, message: "Act not found" });
    }

    act.status = status;
    await act.save();

    console.log("✅ Act status updated:", act.status);
    res.status(200).json({ success: true, message: "Status updated", act });
  } catch (error) {
    console.error("❌ Failed to update act status:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const trashAct = async (req, res) => {
  const { id } = req.body;
  try {
    const act = await actModel.findById(id);
    if (!act) return res.status(404).json({ success: false, message: "Act not found" });

    act.status = "trashed";
    act.trashedAt = new Date();
    await act.save();

    res.json({ success: true, message: "Act moved to trash", act });
  } catch (error) {
    console.error("❌ Error trashing act:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getTrashedActs = async (req, res) => {
  try {
    const acts = await actModel.find({ status: "trashed" }).sort({ trashedAt: -1 });
    res.status(200).json({ success: true, acts });
  } catch (error) {
    console.error("❌ Error fetching trashed acts:", error);
    res.status(500).json({ success: false, message: "Failed to fetch trashed acts" });
  }
};

export const restoreAct = async (req, res) => {
  const { id } = req.body;
  try {
    const act = await actModel.findById(id);
    if (!act) return res.status(404).json({ success: false, message: "Act not found" });

    act.status = "draft";
    act.trashedAt = null;
    await act.save();

    res.json({ success: true, message: "Act restored from trash", act });
  } catch (error) {
    console.error("❌ Error restoring act:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};


export const deleteActPermanently = async (req, res) => {
  const { id } = req.body;

  if (!id) return res.status(400).json({ success: false, message: "Missing act ID" });

  try {
    const deleted = await actModel.findByIdAndDelete(id);    if (!deleted) {
      return res.status(404).json({ success: false, message: "Act not found" });
    }
    return res.status(200).json({ success: true, message: "Act permanently deleted" });
  } catch (error) {
    console.error("Error deleting act permanently:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
