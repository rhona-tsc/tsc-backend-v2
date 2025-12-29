// controllers/agentDashboardController.js
import mongoose from "mongoose";

// ✅ CHANGE THIS IMPORT if your model filename differs
import Shortlist from "../models/shortlistModel.js";

// These two *usually* exist in your project
import actModel from "../models/actModel.js";
import userModel from "../models/userModel.js";

const toIdStr = (v) => (v ? String(v) : "");
const isObjIdLike = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

function extractUserId(doc) {
  return doc?.userId || doc?.user || doc?.ownerId || doc?.createdBy || null;
}

function extractActIds(doc) {
  const keys = ["acts", "shortlistedActs", "items", "actIds", "actIDs"];
  for (const k of keys) {
    const val = doc?.[k];
    if (!Array.isArray(val)) continue;

    const out = [];
    for (const item of val) {
      if (!item) continue;

      // If it's an ObjectId/string:
      if (typeof item === "string" || typeof item === "number") {
        out.push(String(item));
        continue;
      }

      // If it's a populated object or shape like { actId } / { _id }:
      if (typeof item === "object") {
        if (item._id) out.push(String(item._id));
        else if (item.actId) out.push(String(item.actId));
        else if (item.act) out.push(String(item.act));
      }
    }
    return out;
  }
  return [];
}

function pickEventFields(userDoc) {
  // Try your common shapes; adjust if needed.
  return {
    eventDate:
      userDoc?.eventDate ||
      userDoc?.date ||
      userDoc?.event?.date ||
      userDoc?.bookingDate ||
      null,
    eventLocation:
      userDoc?.eventLocation ||
      userDoc?.location ||
      userDoc?.address ||
      userDoc?.event?.location ||
      userDoc?.venueAddress ||
      null,
  };
}

/**
 * GET /api/shortlist/all
 * Returns { success: true, shortlists: [...] }
 * Optionally enriches each shortlist with:
 *  - user: { name, email, createdAt, eventDate, eventLocation }
 *  - acts: [{ _id, name, tscName }]
 */
export async function getAllShortlistsAdmin(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit || 200), 1000);
    const page = Math.max(Number(req.query.page || 1), 1);
    const skip = (page - 1) * limit;

    const includeEnrichment = String(req.query.enrich || "true") === "true";

    const raw = await Shortlist.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    if (!includeEnrichment || !raw.length) {
      return res.json({
        success: true,
        shortlists: raw,
        meta: { page, limit, count: raw.length },
      });
    }

    // Collect ids for enrichment
    const userIds = new Set();
    const actIds = new Set();

    for (const s of raw) {
      const uid = extractUserId(s);
      if (uid) userIds.add(toIdStr(uid));

      extractActIds(s).forEach((id) => {
        if (isObjIdLike(id)) actIds.add(String(id));
      });
    }

    // Fetch users + acts
    const [users, acts] = await Promise.all([
      userIds.size
        ? userModel
            .find({ _id: { $in: Array.from(userIds).filter(isObjIdLike) } })
            .select("_id name firstName lastName email createdAt eventDate date eventLocation location address event")
            .lean()
        : [],
      actIds.size
        ? actModel
            .find({ _id: { $in: Array.from(actIds) } })
            .select("_id name tscName")
            .lean()
        : [],
    ]);

    const usersById = new Map(users.map((u) => [String(u._id), u]));
    const actsById = new Map(acts.map((a) => [String(a._id), a]));

    const shortlists = raw.map((s) => {
      const uid = extractUserId(s);
      const u = uid ? usersById.get(String(uid)) : null;

      const uName =
        u?.name || [u?.firstName, u?.lastName].filter(Boolean).join(" ") || null;

      const event = u ? pickEventFields(u) : { eventDate: null, eventLocation: null };

      const actList = extractActIds(s)
        .map((id) => actsById.get(String(id)))
        .filter(Boolean)
        .map((a) => ({ _id: a._id, name: a.name, tscName: a.tscName }));

      return {
        ...s,
        user: u
          ? {
              _id: u._id,
              name: uName,
              email: u.email || null,
              createdAt: u.createdAt || null,
              ...event,
            }
          : null,
        acts: actList,
      };
    });

    return res.json({
      success: true,
      shortlists,
      meta: { page, limit, count: shortlists.length },
    });
  } catch (e) {
    console.error("getAllShortlistsAdmin error:", e);
    return res.status(500).json({ success: false, message: e.message });
  }
}

// controllers/agentDashboardController.js
export async function getAllUsersAdmin(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit || 200), 1000);
    const page = Math.max(Number(req.query.page || 1), 1);
    const skip = (page - 1) * limit;

    const includeActs = String(req.query.includeActs || "true") === "true";

    let q = userModel
      .find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select(
        "_id name firstName lastName surname email phone createdAt eventDate date eventLocation location address shortlistedActs"
      );

    // This works if your schema is `shortlistedActs: [{ type: ObjectId, ref: 'Act' }]`
    if (includeActs) {
      q = q.populate({ path: "shortlistedActs", select: "_id name tscName" });
    }

    const users = await q.lean();

    return res.json({
      success: true,
      users,
      meta: { page, limit, count: users.length },
    });
  } catch (e) {
    console.error("getAllUsersAdmin error:", e);
    return res.status(500).json({ success: false, message: e.message });
  }
}