import "dotenv/config";
import mongoose from "mongoose";

import Act from "../models/actModel.js";
import Availability from "../models/availabilityModel.js";
import Musician from "../models/musicianModel.js";

const APPLY = process.argv.includes("--apply");
const ACT_ID = "6802679720c1fc5d211f4304";
const EWAN_ID = "6a05f1a00358e40a87adb33d";
const SHAMYRA_ID = "68b4397a416f0bcd9cb6a244";
const WRONG_PHONE = "+447967409498";

const normalizePhone = (value = "") => {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("44")) return `+${digits}`;
  if (digits.startsWith("0")) return `+44${digits.slice(1)}`;
  return digits ? `+${digits}` : "";
};

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) throw new Error("MONGODB_URI or MONGO_URI is required");

await mongoose.connect(uri);

try {
  const [act, shamyra, ewan] = await Promise.all([
    Act.findById(ACT_ID).select("name lineups availabilityBadges").lean(),
    Musician.findById(SHAMYRA_ID)
      .select(
        "firstName lastName email phone phoneNumber phoneNormalized profilePhoto profilePicture",
      )
      .lean(),
    Musician.findById(EWAN_ID)
      .select("firstName lastName phone phoneNumber phoneNormalized")
      .lean(),
  ]);

  if (!act || !shamyra || !ewan) {
    throw new Error("Expected act, Shamyra profile, or Ewan profile is missing");
  }
  if (normalizePhone(ewan.phoneNormalized || ewan.phone) !== WRONG_PHONE) {
    throw new Error("Ewan phone no longer matches the expected corrupt value");
  }
  if (shamyra.firstName !== "Shamyra") {
    throw new Error("The selected canonical profile is not Shamyra");
  }

  const affectedDeputies = [];
  for (const lineup of act.lineups || []) {
    for (const member of lineup.bandMembers || []) {
      for (const deputy of member.deputies || []) {
        if (
          deputy.firstName === "Shamyra" &&
          normalizePhone(deputy.phoneNumber) === WRONG_PHONE
        ) {
          affectedDeputies.push({
            lineupId: String(lineup._id),
            instrument: member.instrument,
          });
        }
      }
    }
  }

  const corruptRowsQuery = {
    actId: new mongoose.Types.ObjectId(ACT_ID),
    isDeputy: true,
    musicianId: new mongoose.Types.ObjectId(EWAN_ID),
    outboundMessage: /^Hi Shamyra\b/i,
  };
  const corruptRows = await Availability.find(corruptRowsQuery)
    .select("_id enquiryId dateISO requestKey reply status")
    .lean();

  const badges = act.availabilityBadges || {};
  const badgeEntries = badges instanceof Map ? [...badges.entries()] : Object.entries(badges);
  const corruptBadgeKeys = badgeEntries
    .filter(([, badge]) => JSON.stringify(badge).includes(EWAN_ID))
    .map(([key]) => key);

  console.log(
    JSON.stringify(
      {
        mode: APPLY ? "apply" : "dry-run",
        act: act.name,
        affectedDeputies,
        corruptAvailabilityRows: corruptRows,
        corruptBadgeKeys,
        canonicalShamyra: {
          id: String(shamyra._id),
          name: `${shamyra.firstName} ${shamyra.lastName}`.trim(),
          email: shamyra.email,
          phone: shamyra.phoneNormalized,
        },
      },
      null,
      2,
    ),
  );

  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to write these corrections.");
    process.exitCode = 2;
  } else {
    const image = shamyra.profilePhoto || shamyra.profilePicture || "";
    const actUpdate = await Act.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(ACT_ID) },
      {
        $set: {
          "lineups.$[].bandMembers.$[member].deputies.$[deputy].id": String(
            shamyra._id,
          ),
          "lineups.$[].bandMembers.$[member].deputies.$[deputy]._id": String(
            shamyra._id,
          ),
          "lineups.$[].bandMembers.$[member].deputies.$[deputy].musicianId":
            String(shamyra._id),
          "lineups.$[].bandMembers.$[member].deputies.$[deputy].firstName":
            shamyra.firstName,
          "lineups.$[].bandMembers.$[member].deputies.$[deputy].lastName":
            shamyra.lastName,
          "lineups.$[].bandMembers.$[member].deputies.$[deputy].email":
            shamyra.email,
          "lineups.$[].bandMembers.$[member].deputies.$[deputy].phoneNumber":
            shamyra.phoneNormalized,
          "lineups.$[].bandMembers.$[member].deputies.$[deputy].image": image,
        },
      },
      {
        arrayFilters: [
          { "member.instrument": /vocal/i },
          {
            "deputy.firstName": "Shamyra",
            "deputy.phoneNumber": { $in: ["+44 7967409498", WRONG_PHONE] },
          },
        ],
      },
    );

    const invalidated = await Availability.updateMany(corruptRowsQuery, {
      $set: {
        reply: null,
        status: "failed",
        deliveryStatus: "invalidated",
        deliveryErrorCode: "DEPUTY_IDENTITY_MISMATCH",
        deliveryErrorMessage:
          "Invalidated: request addressed to Shamyra used Ewan's phone number.",
      },
    });

    let badgeUpdate = { modifiedCount: 0 };
    if (corruptBadgeKeys.length) {
      const unset = Object.fromEntries(
        corruptBadgeKeys.map((key) => [`availabilityBadges.${key}`, ""]),
      );
      badgeUpdate = await Act.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(ACT_ID) },
        { $unset: unset },
      );
    }

    console.log(
      JSON.stringify(
        {
          correctedAct: actUpdate.modifiedCount,
          invalidatedRows: invalidated.modifiedCount,
          clearedBadges: corruptBadgeKeys.length,
          badgeDocumentModified: badgeUpdate.modifiedCount,
        },
        null,
        2,
      ),
    );
  }
} finally {
  await mongoose.disconnect();
}

