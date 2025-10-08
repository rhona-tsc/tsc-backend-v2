import Act from "../models/actModel.js";
import Musician from "../models/musicianModel.js";
import { findPersonByPhone } from "../utils/findPersonByPhone.js";

import {
  findPersonByMusicianId,
  resolveMatchedMusicianPhoto,
  debugLogMusicianByPhone,
} from "./availabilityHelpers.js";

// --- tiny debugger for badge state -----------------------------------------
export async function debugLogBadgeState(actId, label = "badge") {
  try {
    const doc = await Act.findById(actId).select("availabilityBadge").lean();
    const b = doc?.availabilityBadge || {};
    const deps = Array.isArray(b.deputies) ? b.deputies : [];
    console.log(`🔎 ${label}:`, {
      active: !!b.active,
      isDeputy: !!b.isDeputy,
      dateISO: b.dateISO || null,
      address: b.address || null,
      vocalistName: b.vocalistName || null,
      musicianId: b.musicianId || null,
      photoUrl: (b.photoUrl || "").slice(0, 80),
      deputiesCount: deps.length,
      deputiesIds: deps.map((d) => d.musicianId),
    });
  } catch (e) {
    console.warn("⚠️ debugLogBadgeState failed:", e?.message || e);
  }
}


// Local E.164 normalizer (kept here so this helper is standalone)
const normalizePhoneE164_V2 = (raw = "") => {
  let s = String(raw || "").replace(/^whatsapp:/i, "").replace(/\s+/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("07")) return s.replace(/^0/, "+44");
  if (s.startsWith("44")) return `+${s}`;
  return s;
};


// Apply "Featured Vocalist Available" badge after a YES reply.

export async function applyFeaturedBadgeOnYesV2({
  updated,
  actDoc = null,
  musicianDoc = null,
  fromRaw = "",
}) {
  try {
    if (
      !updated ||
      !updated.actId ||
      String(updated.reply || "").toLowerCase() !== "yes"
    ) {
      return;
    }

    const act = actDoc || (await Act.findById(updated.actId).lean());
    if (!act) return;

    let who = null;
    let isDeputy = false;

    // 1) Prefer exact by musicianId
    let match = updated.musicianId
      ? findPersonByMusicianId(act, updated.musicianId)
      : null;
    if (match) {
      who = match.person;
      isDeputy = !!match.parentMember;
    }

    // 2) Fallback by phone in lineup, then all lineups
    if (!who) {
      match =
        findPersonByPhone(act, updated.lineupId, updated.phone || fromRaw) ||
        findPersonByPhone(act, null, updated.phone || fromRaw);
      if (match) {
        who = match.person;
        isDeputy = !!match.parentMember;
      }
    }

    // 3) Helpful debug (will show all phone-normalized variants you store)
    await debugLogMusicianByPhone(updated.phone || fromRaw);

    // 4) Load a Musician doc for photo (only if needed)
    let docForPhoto = musicianDoc;
    if (
      who?.musicianId &&
      (!docForPhoto || String(docForPhoto._id) !== String(who.musicianId))
    ) {
      try {
        docForPhoto = await Musician.findById(who.musicianId).lean();
      } catch {}
    }
    if (!docForPhoto && (who?.email || who?.emailAddress)) {
      try {
        docForPhoto = await Musician.findOne({
          email: who.email || who.emailAddress,
        }).lean();
      } catch {}
    }
    if (!docForPhoto) {
      try {
        const e164 = normalizePhoneE164_V2(updated.phone || fromRaw);
        if (e164) {
          const byPhone = await Musician.findOne({
            $or: [
              { phoneNormalized: e164 },
              { phone: e164 },
              { phoneNumber: e164 },
            ],
          })
            .select(
              "_id musicianProfileImageUpload musicianProfileImage profileImage profilePicture.url photoUrl imageUrl firstName lastName"
            )
            .lean();
          if (byPhone) docForPhoto = byPhone;
        }
      } catch (e) {
        console.warn("⚠️ phoneNormalized lookup failed:", e?.message || e);
      }
    }

    // 5) Resolve a safe photo URL (strict priority via your resolver)
    let resolvedPhotoUrl = resolveMatchedMusicianPhoto({
      who,
      musicianDoc: docForPhoto,
    });
    if (!resolvedPhotoUrl && docForPhoto) {
      const pic =
        (typeof docForPhoto.musicianProfileImageUpload === "string" &&
          docForPhoto.musicianProfileImageUpload) ||
        (typeof docForPhoto.musicianProfileImage === "string" &&
          docForPhoto.musicianProfileImage) ||
        (typeof docForPhoto.profileImage === "string"
          ? docForPhoto.profileImage
          : docForPhoto.profileImage?.url) ||
        (typeof docForPhoto.profilePicture === "string"
          ? docForPhoto.profilePicture
          : docForPhoto.profilePicture?.url) ||
        docForPhoto.photoUrl ||
        docForPhoto.imageUrl ||
        "";
      if (pic) resolvedPhotoUrl = pic;
    }

    const vocalistName = [who?.firstName, who?.lastName]
      .filter(Boolean)
      .join(" ");
    const resolvedMusicianId =
      (who?.musicianId && String(who.musicianId)) ||
      (updated?.musicianId && String(updated.musicianId)) ||
      (docForPhoto?._id && String(docForPhoto._id)) ||
      (musicianDoc?._id && String(musicianDoc._id)) ||
      "";

    // Construct a deputy record we can push if needed
    const deputyRecord = {
      musicianId: resolvedMusicianId,
      vocalistName: vocalistName || (updated?.name || "").trim(),
      photoUrl: resolvedPhotoUrl || "",
      profilePicture:
        (typeof docForPhoto?.profileImage === "string"
          ? docForPhoto.profileImage
          : docForPhoto?.profileImage?.url) ||
        (typeof docForPhoto?.profilePicture === "string"
          ? docForPhoto.profilePicture
          : docForPhoto?.profilePicture?.url) ||
        docForPhoto?.photoUrl ||
        docForPhoto?.imageUrl ||
        "",
      profileUrl: resolvedMusicianId
        ? `${
            process.env.PUBLIC_SITE_URL || "http://localhost:5174"
          }/musician/${resolvedMusicianId}`
        : "",
      setAt: new Date(),
    };

    // Always set the common meta (active + date/address window)
    const commonSet = {
      "availabilityBadge.active": true,
      "availabilityBadge.dateISO": updated.dateISO || null,
      "availabilityBadge.address": updated.formattedAddress || "",
      "availabilityBadge.setAt": new Date(),
    };

   if (!isDeputy) {
  await Act.updateOne(
    { _id: act._id },
    {
      $set: {
        ...commonSet,
        "availabilityBadge.isDeputy": false,
        "availabilityBadge.vocalistName": vocalistName || (updated?.name || "").trim(),
        "availabilityBadge.photoUrl": resolvedPhotoUrl || "",
        "availabilityBadge.musicianId": resolvedMusicianId || "",
      },
    }
  );
  await debugLogBadgeState(act._id, "after LEAD YES");
} else {
  // Log state before any changes
  await debugLogBadgeState(act._id, "before DEPUTY YES");

  // Always ensure the meta for this date/address is set
  const setMetaRes = await Act.updateOne(
    { _id: act._id },
    {
      $set: {
        ...commonSet,
        "availabilityBadge.isDeputy": true,
        "availabilityBadge.vocalistName": deputyRecord.vocalistName,
        "availabilityBadge.photoUrl": deputyRecord.photoUrl,
        "availabilityBadge.musicianId": deputyRecord.musicianId,
      },
    }
  );
  console.log("🧭 set meta result:", {
    matched: setMetaRes.matchedCount,
    modified: setMetaRes.modifiedCount,
  });

  // Remove any existing entry for this musicianId (dedupe)
  const pullRes = await Act.updateOne(
    { _id: act._id },
    { $pull: { "availabilityBadge.deputies": { musicianId: deputyRecord.musicianId } } }
  );
  console.log("🧹 pull deputy result:", {
    matched: pullRes.matchedCount,
    modified: pullRes.modifiedCount,
  });

  // Push this deputy to the FRONT, keep only the latest 3 for this badge/date
  const pushRes = await Act.updateOne(
    { _id: act._id },
    {
      $push: {
        "availabilityBadge.deputies": {
          $each: [deputyRecord],
          $position: 0,
          $slice: 3, // keep max 3 (remove this if you want unbounded)
        },
      },
    }
  );
  console.log("➕ push deputy result:", {
    matched: pushRes.matchedCount,
    modified: pushRes.modifiedCount,
  });

  // Log state after
  await debugLogBadgeState(act._id, "after DEPUTY YES");
}

console.log("🏷️ [V2] Applying featured badge", {
  actId: updated.actId?.toString?.(),
  vocalistName,
  isDeputy,
  photoUrl: resolvedPhotoUrl,
  dateISO: updated.dateISO,
  address: updated.formattedAddress,
  musicianId: resolvedMusicianId,
});
  } catch (e) {
    console.warn("⚠️ applyFeaturedBadgeOnYesV2 failed:", e?.message || e);
  }
}
export default { debugLogBadgeState, applyFeaturedBadgeOnYesV2 };