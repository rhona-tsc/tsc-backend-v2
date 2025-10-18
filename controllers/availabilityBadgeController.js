// backend/controllers/availabilityBadgeController.js
import Act from "../models/actModel.js";
import AvailabilityModel from "../models/availabilityModel.js";
import { findPersonByPhone } from "../utils/findPersonByPhone.js";

/* -------------------------------------------------------------------------- */
/*                        buildBadgeFromAvailability                          */
/* -------------------------------------------------------------------------- */
export async function buildBadgeFromAvailability(actId, dateISO) {
  console.log(`🐊 (controllers/availabilityBadgeController.js) buildBadgeFromAvailability called at`, new Date().toISOString(), { actId, dateISO });
  const act = await Act.findById(actId).lean();
  if (!act) throw new Error("Act not found");

  const availRows = await AvailabilityModel.find({
    actId,
    dateISO,
    reply: { $in: ["yes", "no", "unavailable"] },
  }).lean();

  console.log(`🐊 buildBadgeFromAvailability found ${availRows.length} replies`, {
    actId,
    dateISO,
  });

  if (!availRows.length) return null;

  const yesReplies = availRows.filter(r => r.reply === "yes");
  console.log(`🐊 buildBadgeFromAvailability YES replies`, yesReplies.length);

  if (!yesReplies.length) return null;

  const getMusicianFromReply = async (replyRow) => {
    console.log(`🐊 buildBadgeFromAvailability.getMusicianFromReply called`, {
      phone: replyRow.phone || replyRow.availabilityPhone,
      replyId: replyRow._id?.toString?.(),
    });
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

  console.log(`🐊 buildBadgeFromAvailability assigning lead and ${deputies.length} deputies`);

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
      console.log(`🐊 buildBadgeFromAvailability added deputy`, { name: depData.name });
    }
  }

  badge.deputies = badge.deputies.slice(0, 3);
  console.log(`🐊 buildBadgeFromAvailability complete`, {
    actId,
    vocalistName: badge.vocalistName,
    deputies: badge.deputies.map(d => d.vocalistName),
  });
  return badge;
}

/* -------------------------------------------------------------------------- */
/*                          getAvailabilityBadge (GET)                        */
/* -------------------------------------------------------------------------- */
export async function getAvailabilityBadge(req, res) {
  console.log(`🐊 (controllers/availabilityBadgeController.js) getAvailabilityBadge called at`, new Date().toISOString(), {
    params: req.params,
  });
  try {
    const { actId, dateISO } = req.params;
    const badge = await buildBadgeFromAvailability(actId, dateISO);

    if (!badge) {
      console.log(`🐊 getAvailabilityBadge: No YES replies`, { actId, dateISO });
      return res.json({ success: true, updated: false, badge: null });
    }

    await Act.updateOne({ _id: actId }, { $set: { availabilityBadge: badge } });

    console.log(`🐊 getAvailabilityBadge updated`, {
      actId,
      dateISO,
      vocalistName: badge.vocalistName,
    });
    res.json({ success: true, updated: true, badge });
  } catch (err) {
    console.error(`🐊 getAvailabilityBadge error`, err);
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
}