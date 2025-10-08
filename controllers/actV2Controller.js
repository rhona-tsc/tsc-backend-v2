import actModel from "../models/actModel.js"

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
    const isSubmit = incoming.submit === true || incoming.submit === "true";

    // Decide final status
    let nextStatus = existingAct.status;
    if (isSubmit) {
      const wasApproved = existingAct.status === "approved" || existingAct.status === "live";
      nextStatus = wasApproved ? "Approved, changes pending" : "pending";
    }

    // Support optional explicit clearing:
    // { clearKeys: ['coverImage', 'lineups.0.bandMembers.2.deputies'] }
    const clearKeys = Array.isArray(incoming.clearKeys) ? incoming.clearKeys : [];
    const $unset = clearKeys.reduce((acc, path) => { acc[path] = ""; return acc; }, {});

    // For non-submit (autosave): non-destructive; only set meaningful fields
    // For submit: allow full set (still filtered through buildSetDoc to avoid _id, etc.)
    const $set = buildSetDoc(incoming);

    // Prevent client from changing ownership fields
    delete $set.createdBy;
    delete $set.createdByRole;
    delete $set.owner;
    delete $set.ownerId;
    delete $set.registeredBy;
    delete $set.userId;
    delete $set.musicianId;
    delete $set.owners;

    // Never let client arbitrarily set status here; we control it
    $set.status = nextStatus;

    // Prevent replacing large subtrees with empties (already handled by buildSetDoc)
    // Example: if incoming.images = [], it won’t be set on autosave (non-submit).

    const updatedAct = await actModel.findByIdAndUpdate(
      actId,
      Object.keys($unset).length ? { $set, $unset } : { $set },
      { new: true, runValidators: true }
    );

    if (!updatedAct) {
      return res.status(404).json({ error: "Act not found" });
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
    const data = req.body;
    // Stamp with creating user
    const authUserId = req.user?.id || req.user?._id || req.headers.userid || null;
    const authUserRole = req.user?.role || req.headers.userrole || null;
    const authUserEmail = req.user?.email || req.headers.useremail || null;
    const authUserName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim();
    // Log lightingSystem and setlist
    console.log("🔦 Creating act with lightingSystem:", data.lightingSystem);
    console.log("📜 Creating act with setlist:", data.setlist);
    const finalStatus = data.status || "pending";
    console.log("📌 Final status before save:", finalStatus);
    const newAct = new actModel({
      ...data,
      status: finalStatus,
      ...(authUserId ? { createdBy: authUserId } : {}),
      ...(authUserRole ? { createdByRole: authUserRole } : {}),
      ...(authUserEmail ? { createdByEmail: authUserEmail } : {}),
      ...(authUserName ? { createdByName: authUserName } : {}),
    });
    await newAct.save();

    res.status(201).json({ message: "Act created", id: newAct._id });
  } catch (err) {
    console.error("❌ Failed to create act:", err);
    res.status(500).json({ error: "Failed to create act", details: err.message });
  }
};

  export const getActByIdV2 = async (req, res) => {
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
    // Force draft on autosave route
    const status = "draft";

    if (data._id) {
      const existing = await actModel.findById(data._id);
      if (!existing) {
        return res.status(404).json({ error: "Draft not found to update" });
      }

      // Non-destructive: only set meaningful fields on autosave
      const $set = buildSetDoc(data);
      $set.status = status;

      // Optional clears
      const clearKeys = Array.isArray(data.clearKeys) ? data.clearKeys : [];
      const $unset = clearKeys.reduce((acc, path) => { acc[path] = ""; return acc; }, {});

      const updated = await actModel.findByIdAndUpdate(
        data._id,
        Object.keys($unset).length ? { $set, $unset } : { $set },
        { new: true }
      );

      return res.status(200).json({ message: "Draft updated", _id: updated._id });
    } else {
      // Creating a new draft
      const toCreate = { ...data, status };
      const doc = new actModel(toCreate);
      await doc.save();
      return res.status(201).json({ message: "Draft created", _id: doc._id });
    }
  } catch (err) {
    console.error("❌ Failed to save act draft:", err);
    res.status(500).json({ error: "Failed to save act draft", details: err.message });
  }
};

// allow-list of safe fields to return
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

    // --- Ownership scoping vars ---
    const authUserId = req.user?.id || req.user?._id || req.headers.userid || null;
    const authUserRole = req.user?.role || req.headers.userrole || null;
    const mineFlag = String(req.query.mine || req.headers["x-scope"] || "").toLowerCase() === "mine" || String(req.query.authorId || "").length > 0;

    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const pg = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (pg - 1) * lim;

    const projection = sanitizeFields(fields) || {
      _id: 1, name: 1, tscName: 1, images: 1, coverImage: 1, createdAt: 1, status: 1, amendment: 1,
    };

    const filter = {};
    if (includeTrashed !== "true") filter.status = { $ne: "trashed" };

    const statuses = parseStatuses(status);
    if (statuses && statuses.length) {
      if (filter.status) {
        filter.$and = [{ status: filter.status }, { status: { $in: statuses } }];
        delete filter.status;
      } else {
        filter.status = { $in: statuses };
      }
    }

    if (q && q.trim()) {
      const re = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ name: re }, { tscName: re }];
    }

    // --- Ownership scoping ---
    // If the caller is a musician, always restrict to their acts.
    // Admin/moderator can opt-in via ?mine=true or ?authorId=...
    if (authUserRole === "musician") {
      if (!authUserId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Missing user id" });
      }
      const uid = String(authUserId);
      filter.$or = [
        { createdBy: uid },
        { owner: uid },
        { ownerId: uid },
        { registeredBy: uid },
        { userId: uid },
        { musicianId: uid },
        { owners: uid },
      ];
    } else if (mineFlag) {
      const uid = String(req.query.authorId || authUserId || "");
      if (uid) {
        // Merge with existing $or if present
        const mineOr = [
          { createdBy: uid },
          { owner: uid },
          { ownerId: uid },
          { registeredBy: uid },
          { userId: uid },
          { musicianId: uid },
          { owners: uid },
        ];
        if (filter.$or) {
          filter.$and = filter.$and || [];
          filter.$and.push({ $or: mineOr });
        } else {
          filter.$or = mineOr;
        }
      }
    }
  if (req.query.authorId) {
    const authorId = String(req.query.authorId);
    const ownershipConditions = [
      { createdBy: authorId },
      { owner: authorId },
      { ownerId: authorId },
      { registeredBy: authorId },
      { userId: authorId },
      { musicianId: authorId },
      { owners: authorId },
    ];
    if (filter.$or) {
      filter.$and = filter.$and || [];
      filter.$and.push({ $or: ownershipConditions });
    } else {
      filter.$or = ownershipConditions;
    }
  }
    const [total, acts] = await Promise.all([
      actModel.countDocuments(filter),
      actModel.find(filter, projection).sort(sort).skip(skip).limit(lim).lean(),
    ]);

    res.json({
      success: true,
      total,
      page: pg,
      pageSize: acts.length,
      hasMore: skip + acts.length < total,
      acts,
    });
  } catch (err) {
    console.error("❌ Error fetching act list:", err);
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
