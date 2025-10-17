import Act from "../models/actModel.js";
import AvailabilityModel from "../models/availabilityModel.js";
import { findPersonByPhone } from "../utils/findPersonByPhone.js";

// 🔹 Shared logic — can also be reused by rebuildAvailabilityBadge
export async function buildBadgeFromAvailability(actId, dateISO) {
  const act = await Act.findById(actId).lean();
  if (!act) throw new Error("Act not found");

  const availRows = await AvailabilityModel.find({
    actId,
    dateISO,
    reply: { $in: ["yes", "no", "unavailable"] },
  }).lean();

  if (!availRows.length) return null;

  const yesReplies = availRows.filter(r => r.reply === "yes");
  if (!yesReplies.length) return null;

  const getMusicianFromReply = async (replyRow) => {
    const phone = replyRow.phone || replyRow.availabilityPhone;
    if (!phone) return null;
    const person = await findPersonByPhone(phone);
    if (!person) return null;

    const name = `${person.firstName || ""} ${person.lastName || ""}`.trim() || person.displayName || "(unknown)";
    const photoUrl =
      person.profilePicture?.url ||
      person.profilePicture ||
      (Array.isArray(person.images) && person.images[0]?.url) ||
      "";

    return { person, name, photoUrl };
  };

  const lead = yesReplies[0];
  const deputies = yesReplies.slice(1, 4);

  const leadData = await getMusicianFromReply(lead);

  const badge = {
    active: true,
    dateISO,
    vocalistName: leadData?.name || "(unknown)",
    musicianId: leadData?.person?._id || null,
    photoUrl: leadData?.photoUrl || "",
    profileUrl: leadData?.person?._id ? `/musician/${leadData.person._id}` : "",
    setAt: lead.repliedAt || new Date(),
    isDeputy: false,
    deputies: [],
  };

  for (const dep of deputies) {
    const depData = await getMusicianFromReply(dep);
    if (depData) {
      badge.deputies.push({
        musicianId: depData.person?._id || null,
        vocalistName: depData.name,
        photoUrl: depData.photoUrl,
        profileUrl: depData.person?._id ? `/musician/${depData.person._id}` : "",
        setAt: dep.repliedAt || new Date(),
      });
    }
  }

  badge.deputies = badge.deputies.slice(0, 3);
  return badge;
}

// GET endpoint handler
export async function getAvailabilityBadge(req, res) {
  try {
    const { actId, dateISO } = req.params;
    const badge = await buildBadgeFromAvailability(actId, dateISO);

    if (!badge) {
      console.log(`⚠️ No YES replies for act ${actId} on ${dateISO}`);
      return res.json({ success: true, updated: false, badge: null });
    }

    // Optionally: persist to Act for caching
    await Act.updateOne({ _id: actId }, { $set: { availabilityBadge: badge } });

    console.log("✅ [Data-driven badge refresh]", { actId, dateISO, name: badge.vocalistName });
    res.json({ success: true, updated: true, badge });
  } catch (err) {
    console.error("❌ getAvailabilityBadge error:", err);
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
}