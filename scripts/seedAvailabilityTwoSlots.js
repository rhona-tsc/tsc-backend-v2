// seedAvailabilityTwoSlots.js
// Run with:
//   mongosh "<MONGODB_URI>" --file seedAvailabilityTwoSlots.js
//
// What it does:
// - Upserts TWO Availability docs for the SAME act/date/requestKey/lineup/phone/v2
// - One with slotIndex: 0, one with slotIndex: 1
// - Sets reply: "yes" (so your badge/email logic can treat them as available)

const { ObjectId } = require("mongodb");

// ---------------------------- CONFIG (edit me) ----------------------------
const ACT_ID = "6804f31864335e143efb404f";          // e.g. "696fcb4da8c6fc3eba3446b3"
const LINEUP_ID = "2cd3daec-343e-4e4e-9e76-d9df231114d3";                   // optional: "PUT_LINEUP_ID_HERE" or null
const MUSICIAN_ID = null;                 // optional: "PUT_MUSICIAN_ID_HERE" or null

const DATE_ISO = "2026-01-15";            // past date for testing
const FORMATTED_ADDRESS = "Test Address, London"; // whatever you want
const CLIENT_EMAIL = "hello@thesupremecollective.co.uk"; // so it emails you
const CLIENT_NAME = "Rhona";

// IMPORTANT: requestKey is part of your unique index.
// Use a stable value for the scenario you’re testing.
const REQUEST_KEY = "test_email_trigger_two_slots";

// Also in your unique index:
const PHONE = "+447900000000";
const V2 = true;

// Optional metadata (nice for debugging)
const ENQUIRY_ID = `${ACT_ID}_${DATE_ISO}_test`;
const ACT_NAME = "Funk Royale"; // or "Gotta Be Garage"
// -------------------------------------------------------------------------

function oid(v) {
  if (!v) return undefined;
  return new ObjectId(String(v));
}

const dbName = db.getName();
print(`\n✅ Using DB: ${dbName}`);

const col = db.getCollection("availabilities"); // Mongoose model name "Availability" -> collection usually "availabilities"
print(`✅ Using collection: ${col.getName()}\n`);

const now = new Date();

function upsertSlot(slotIndex) {
  const filter = {
    actId: oid(ACT_ID),
    requestKey: REQUEST_KEY,
    lineupId: LINEUP_ID ? oid(LINEUP_ID) : null,
    dateISO: DATE_ISO,
    phone: PHONE,
    v2: V2,
    slotIndex: slotIndex,
  };

  const update = {
    $set: {
      enquiryId: ENQUIRY_ID,
      requestId: ENQUIRY_ID, // if you’re using this elsewhere too
      actName: ACT_NAME,
      clientName: CLIENT_NAME,
      clientEmail: CLIENT_EMAIL,
      formattedAddress: FORMATTED_ADDRESS,
      dateISO: DATE_ISO,
      date: new Date(`${DATE_ISO}T00:00:00.000Z`),
      v2: V2,

      // make it "available"
      reply: "yes",
      repliedAt: now,

      // optional refs
      lineupId: LINEUP_ID ? oid(LINEUP_ID) : null,
      musicianId: MUSICIAN_ID ? oid(MUSICIAN_ID) : null,

      // optional flags
      isDeputy: false,

      // status-ish
      status: "delivered",
    },
    $setOnInsert: {
      createdAt: now,
    },
    $currentDate: {
      updatedAt: true,
    },
  };

  const res = col.updateOne(filter, update, { upsert: true });
  print(
    `slotIndex ${slotIndex}: matched=${res.matchedCount} modified=${res.modifiedCount} upserted=${res.upsertedCount}`
  );
}

upsertSlot(0);
upsertSlot(1);

print("\n🔎 Current docs:");
const docs = col
  .find({
    actId: oid(ACT_ID),
    requestKey: REQUEST_KEY,
    dateISO: DATE_ISO,
    phone: PHONE,
    v2: V2,
    slotIndex: { $in: [0, 1] },
  })
  .project({
    _id: 1,
    actId: 1,
    requestKey: 1,
    lineupId: 1,
    dateISO: 1,
    phone: 1,
    v2: 1,
    slotIndex: 1,
    reply: 1,
    clientEmail: 1,
    clientName: 1,
    formattedAddress: 1,
    createdAt: 1,
    updatedAt: 1,
  })
  .sort({ slotIndex: 1 })
  .toArray();

printjson(docs);

print("\n✅ Done.\n");