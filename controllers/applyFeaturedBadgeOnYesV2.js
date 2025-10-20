import Act from "../models/actModel.js";
import Musician from "../models/musicianModel.js";
import { findPersonByPhone } from "../utils/findPersonByPhone.js";
import {
  findPersonByMusicianId,
  resolveMatchedMusicianPhoto,
  debugLogMusicianByPhone,
} from "./availabilityHelpers.js";
import { rebuildAndApplyBadge } from "./availabilityController.js";


// --- tiny debugger for badge state -----------------------------------------
export async function debugLogBadgeState(actId, label = "badge") {
   console.log(`🟡 (controllers/applyFeaturedBadgeOnYesV2.js) debugLogBadgeState START at ${new Date().toISOString()}`, {
 });
  try {
    const doc = await Act.findById(actId).select("availabilityBadges").lean();
    const b = doc?.availabilityBadges || {};
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

// --- Local E.164 normalizer -------------------------------------------------
const normalizePhoneE164_V2 = (raw = "") => {
   console.log(`🟡 (controllers/applyFeaturedBadgeOnYesV2.js) normalizePhoneE164_V2 START at ${new Date().toISOString()}`, {
 });
  let s = String(raw || "").replace(/^whatsapp:/i, "").replace(/\s+/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("07")) return s.replace(/^0/, "+44");
  if (s.startsWith("44")) return `+${s}`;
  return s;
};

// --- Apply "Featured Vocalist Available" badge after a YES reply ------------
export async function applyFeaturedBadgeOnYesV2({
  
  updated,
  actDoc = null,
  musicianDoc = null,
  fromRaw = "",
}) {
   console.log(`🟡 (controllers/applyFeaturedBadgeOnYesV2.js) applyFeaturedBadgeOnYesV2 START at ${new Date().toISOString()}`, {
 });
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

    // 1️⃣ Prefer exact by musicianId
 let match = updated.musicianId
  ? findPersonByMusicianId(act, updated.musicianId)
  : null;

if (match) {
  who = match.person;
  // ✅ Mark as deputy if parentMember exists OR match.isDeputy is true
  isDeputy = !!(match.parentMember || match.isDeputy || who?.isDeputy);
}

    // 2️⃣ Fallback by phone
    if (!who) {
      match =
        findPersonByPhone(act, updated.lineupId, updated.phone || fromRaw) ||
        findPersonByPhone(act, null, updated.phone || fromRaw);
      if (match) {
        who = match.person;
        isDeputy = !!match.parentMember;
      }
    }

    if (who && !isDeputy) {
  // Double check if this person appears as a deputy anywhere
  const deputyHit = act.lineups?.some(lineup =>
    lineup.bandMembers?.some(mem =>
      mem.deputies?.some(dep => String(dep.musicianId) === String(who.musicianId))
    )
  );
  if (deputyHit) isDeputy = true;
}

    // 3️⃣ Debug
    await debugLogMusicianByPhone(updated.phone || fromRaw);

    // 4️⃣ Load Musician doc for photo
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

    // 5️⃣ Resolve photo URL
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

    // Build deputy record
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

    const commonSet = {
      "availabilityBadges.dateISO": updated.dateISO || null,
      "availabilityBadges.address": updated.formattedAddress || "",
      "availabilityBadges.setAt": new Date(),
    };

    // 🎤 If lead replies YES → set lead as active
    if (!isDeputy) {
      await Act.updateOne(
        { _id: act._id },
        {
          $set: {
            ...commonSet,
            "availabilityBadges.active": true,
            "availabilityBadges.isDeputy": false,
            "availabilityBadges.vocalistName":
              vocalistName || (updated?.name || "").trim(),
            "availabilityBadges.photoUrl": resolvedPhotoUrl || "",
            "availabilityBadges.musicianId": resolvedMusicianId || "",
          },
        }
      );
      await debugLogBadgeState(act._id, "after LEAD YES");
    }

    // 🎤 If deputy replies YES → accumulate deputies
    else {
      await debugLogBadgeState(act._id, "before DEPUTY YES");

      // Keep lead inactive; just update deputies
      await Act.updateOne(
        { _id: act._id },
        {
          $set: {
            ...commonSet,
            "availabilityBadges.active": false,
            "availabilityBadges.isDeputy": true,
          },
        }
      );

      // Remove duplicate deputy if exists
      await Act.updateOne(
        { _id: act._id },
        {
          $pull: {
            "availabilityBadges.deputies": {
              musicianId: deputyRecord.musicianId,
            },
          },
        }
      );

      // Push this deputy (max 3)
      const pushRes = await Act.updateOne(
        { _id: act._id },
        {
          $push: {
            "availabilityBadges.deputies": {
              $each: [deputyRecord],
              $position: 0,
              $slice: 3,
            },
          },
        }
      );

      console.log("➕ push deputy result:", {
        matched: pushRes.matchedCount,
        modified: pushRes.modifiedCount,
      });

      // after updating the availability record
await rebuildAndApplyBadge(updated.actId, updated.dateISO);

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

// --- Apply "Featured Vocalist Available" badge after a YES reply (Hybrid v3) ---
export async function applyFeaturedBadgeOnYesV3({
  updated,
  actDoc = null,
  musicianDoc = null,
  fromRaw = "",
}) {
   console.log(`🟡 (controllers/applyFeaturedBadgeOnYesV2.js) applyFeaturedBadgeOnYesV3 START at ${new Date().toISOString()}`, {
 });
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

    console.log("🎯 [applyFeaturedBadgeOnYesV3] triggered for", {
      actName: act.tscName || act.name,
      dateISO: updated.dateISO,
      phone: updated.phone,
      fromRaw,
    });

    // 🧩 1️⃣ Identify musician
    const e164 = normalizePhoneE164_V2(updated.phone || fromRaw);
    let musician =
      musicianDoc ||
      (await Musician.findOne({
        $or: [
          { _id: updated.musicianId },
          { phoneNormalized: e164 },
          { phone: e164 },
          { phoneNumber: e164 },
          { email: updated.email },
        ],
      })
        .select(
          "_id firstName lastName email profilePicture coverHeroImage musicianProfileImageUpload musicianProfileImage images digitalWardrobeBlackTie digitalWardrobeFormal digitalWardrobeSmartCasual"
        )
        .lean());

    if (!musician) {
      console.warn("⚠️ No musician found for", e164, "— badge skipped");
      return;
    }

    const isDeputy = act.lineups?.some(l =>
      l.bandMembers?.some(m =>
        m.deputies?.some(d => String(d.musicianId) === String(musician._id))
      )
    );

    // 🧠 2️⃣ Pick best photo from all known fields
    const possiblePhotos = [
      musician.profilePicture?.url,
      musician.profilePicture,
      musician.coverHeroImage,
      musician.musicianProfileImageUpload?.url,
      musician.musicianProfileImage?.url,
      musician.images?.[0]?.url,
      musician.digitalWardrobeBlackTie?.[0],
      musician.digitalWardrobeFormal?.[0],
      musician.digitalWardrobeSmartCasual?.[0],
    ].filter(Boolean);

    const photoUrl = possiblePhotos[0] || "";

    const vocalistName =
      [musician.firstName, musician.lastName].filter(Boolean).join(" ") ||
      updated.musicianName ||
      "Unknown";

    const musicianId = String(musician._id);

    // 🧾 3️⃣ Shared update fields
    const baseSet = {
      "availabilityBadges.dateISO": updated.dateISO || null,
      "availabilityBadges.address": updated.formattedAddress || "",
      "availabilityBadges.setAt": new Date(),
    };

    // 🎤 4️⃣ If lead
    if (!isDeputy) {
      await Act.updateOne(
        { _id: act._id },
        {
          $set: {
            ...baseSet,
            "availabilityBadges.active": true,
            "availabilityBadges.isDeputy": false,
            "availabilityBadges.vocalistName": vocalistName,
            "availabilityBadges.musicianId": musicianId,
            "availabilityBadges.photoUrl": photoUrl,
            "availabilityBadges.profileUrl": `${
              process.env.PUBLIC_SITE_URL || "http://localhost:5174"
            }/musician/${musicianId}`,
          },
        }
      );
      console.log("✅ Lead badge updated:", { vocalistName, photoUrl });
    }

    // 🎙️ 5️⃣ If deputy
    else {
      const deputyRecord = {
        musicianId,
        vocalistName,
        photoUrl,
        profileUrl: `${
          process.env.PUBLIC_SITE_URL || "http://localhost:5174"
        }/musician/${musicianId}`,
        setAt: new Date(),
      };

      await Act.updateOne(
        { _id: act._id },
        {
          $set: {
            ...baseSet,
            "availabilityBadges.isDeputy": true,
          },
          $pull: { "availabilityBadges.deputies": { musicianId } },
        }
      );

      await Act.updateOne(
        { _id: act._id },
        {
          $push: {
            "availabilityBadges.deputies": {
              $each: [deputyRecord],
              $position: 0,
              $slice: 3,
            },
          },
        }
      );

      // 🔁 refresh after deputy added
      await rebuildAndApplyBadge(updated.actId, updated.dateISO);
      console.log("➕ Deputy badge updated:", vocalistName);
    }

    await debugLogBadgeState(act._id, "[applyFeaturedBadgeOnYesV3]");
  } catch (err) {
    console.error("❌ applyFeaturedBadgeOnYesV3 error:", err.message);
  }
}
export default { debugLogBadgeState, applyFeaturedBadgeOnYesV2 };