// scripts/importMusiciansFromCsv.js
import "dotenv/config";
import mongoose from "mongoose";
import fs from "fs";
import csvParser from "csv-parser";
import musicianModel from "../models/musicianModel.js";

// CLI
// Usage:
//   node scripts/importMusiciansFromCsv.js /path/to/import.csv
//   node scripts/importMusiciansFromCsv.js /path/to/import.csv --prune /path/to/unsub.csv --prune /path/to/cleaned.csv
//
// The --prune files should contain an "Email Address" column (Mailchimp exports) or any reasonable email column.
const argv = process.argv.slice(2);
const CSV_PATH = argv[0];

const PRUNE_FILES = [];
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === "--prune" && argv[i + 1]) {
    PRUNE_FILES.push(argv[i + 1]);
    i += 1;
  }
}

if (!CSV_PATH) {
  console.error(
    "Usage: node scripts/importMusiciansFromCsv.js /path/to/file.csv [--prune /path/to/unsub.csv] [--prune /path/to/cleaned.csv]"
  );
  process.exit(1);
}

// ------------------------------- helpers ---------------------------------
const yes = (v) => String(v || "").trim().toLowerCase() === "yes";

const pickFirst = (...vals) => {
  for (const v of vals) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
};

const normalizeEmail = (v) => String(v || "").trim().toLowerCase();

const pickEmailFromRow = (row) => {
  const email = pickFirst(
    row["Email Address"],
    row["Email"],
    row["email"],
    row["Email address"],
    row["E-mail"],
    row["E-mail Address"],
    row["Your email"],
    row["What is your email address?"],
    row["EMAIL"],
    row["EmailAddress"],
    row["email_address"]
  );
  return normalizeEmail(email);
};

const safeSplitFirstWord = (raw = "") => {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.split(/\s+/)[0] || "";
};

const splitLinks = (raw) =>
  String(raw || "")
    .split(/\r?\n|,\s*/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);

const SOCIAL_PLATFORMS = [
  { key: "instagram", re: /instagram\.com/i },
  { key: "facebook", re: /facebook\.com/i },
  { key: "youtube", re: /youtu\.be|youtube\.com/i },
  { key: "tiktok", re: /tiktok\.com/i },
  { key: "spotify", re: /spotify\.com/i },
  { key: "soundcloud", re: /soundcloud\.com/i },
  { key: "website", re: /^https?:\/\//i },
];

const detectPlatform = (url) => {
  const hit = SOCIAL_PLATFORMS.find((p) => p.re.test(url));
  return hit ? hit.key : "website";
};

const buildFromRow = (row) => {
  // Skip the embedded “Tag” row
  if (String(row["Timestamp"] || "").trim().toLowerCase() === "tag") return null;

  // Be tolerant to different CSV headers
  const email = pickEmailFromRow(row);

  // If we still don't have an email, we can't import this person.
  if (!email) return null;

  const fullName = pickFirst(row["What is your full name?"], row["Full Name"], row["Name"], row["Your name"]);
  const firstName = pickFirst(row["First Name"], safeSplitFirstWord(fullName), email.split("@")[0]);
  const lastName = pickFirst(row["Last Name"], String(fullName || "").trim().split(/\s+/).slice(1).join(" "));

  const phone = pickFirst(row["What is your phone number?"]);

  // Build instrumentation from “Do you play X to an expert level?”
  const instruments = [
    ["Electric Bass", "Do you play electric bass guitar to an expert level?"],
    ["Acoustic Bass", "Do you play acoustic bass guitar to an expert level?"],
    ["Double Bass", "Do you play double bass to an expert level?"],
    ["Electric Guitar", "Do you play electric guitar to an expert level?"],
    ["Acoustic Guitar", "Do you play acoustic guitar to an expert level?"],
    ["Banjo", "Do you play banjo to an expert level?"],
    ["Drums", "Do you play drums to an expert level?"],
    ["Cajon", "Do you play cajon to an expert level?"],
    ["Keys", "Do you play keys to an expert level?"],
    ["Saxophone", "Do you play saxophone to an expert level?"],
    ["Trumpet", "Do you play trumpet to an expert level?"],
    ["Trombone", "Do you play trombone to an expert level?"],
  ];

  const instrumentation = instruments
    .filter(([_, col]) => yes(row[col]))
    .map(([instrument]) => ({ instrument, skill_level: "Expert" }));

  // Vocals
  const vocalsType = [];
  let vocalsGender = "";

  if (yes(row["Are you a female lead vocalist?"])) {
    vocalsType.push("Lead Vocalist");
    vocalsGender = "Female";
  }
  if (yes(row["Are you a male lead vocalist?"]) || yes(row["Are you a male lead vocalist-guitarist?"])) {
    vocalsType.push("Lead Vocalist");
    vocalsGender = vocalsGender || "Male";
  }

  const canDoBackingVocals = yes(row["Can you sing backing vocals?"]);
  if (canDoBackingVocals && !vocalsType.includes("Backing Vocalist")) vocalsType.push("Backing Vocalist");

  const vocals = {
    type: vocalsType,
    gender: vocalsGender || "",
    range: "",
    rap: "",
    genres: [],
  };

  // Skills/logistics
  const other_skills = [];
  const logistics = [];

  if (yes(row["Can you DJ to an expert level?"])) other_skills.push("DJ with Decks");
  if (yes(row["Do you have a mixing decks and a laptop for DJing?"])) other_skills.push("DJ with Mixing Console");
  if (yes(row["Do you have a PA system?"])) other_skills.push("Sound Engineering with PA & Lights Provision");
  if (yes(row["Do you have a lighting system?"])) other_skills.push("Sound Engineering with PA & Lights Provision");

  if (yes(row["Do you have your own transport?"])) logistics.push("Own transport");
  if (
    yes(
      row[
        "If you have your own transport, do you have space for another band member and their instrument and amp in your vehicle?"
      ]
    )
  ) {
    logistics.push("Can take another band member");
  }

  // Promo + bio + socials
  const promoLinks = splitLinks(
    row["Please provide your best promo link(s) (ideally live party covers)"]
  );
  const bio = String(row["Please provide your bio"] || "").trim();
  const socialLinksRaw = splitLinks(row["Please provide links to your social media pages"]);

  const social_media_links = socialLinksRaw.map((url) => ({
    platform: detectPlatform(url),
    url,
  }));

  // Store “where based” into address.town (best effort)
  const based = String(
    row[
      "If you are able to take another band member in your vehicle, where are you based?"
    ] ||
      row["Where are you based?"] ||
      ""
  ).trim();

  // NOTE: Even if most fields are blank, we still return a minimal musician profile.
  // This ensures /bulk-invite can reach them later.
  return {
    email,
    firstName,
    lastName,
    phone,
    basicInfo: { firstName, lastName, phone, email },
    instrumentation,
    vocals,
    other_skills,
    logistics,
    bio,
    functionBandVideoLinks: promoLinks.map((url) => ({ title: "", url })),
    social_media_links,
    address: {
      line1: "",
      line2: "",
      town: based,
      county: "",
      postcode: "",
      country: "UK",
    },
    role: "musician",
    status: "approved", // IMPORTANT: so /bulk-invite picks them up

    // ✅ do not set password for imports
    password: null,
    hasSetPassword: false,
    mustChangePassword: true,
    onboardingStatus: "not_started",
  };
};

async function pruneFromCsvFiles(files = []) {
  const uniqueFiles = Array.from(new Set((files || []).filter(Boolean)));
  if (!uniqueFiles.length) return { files: 0, emails: 0, deleted: 0 };

  const emails = new Set();

  for (const file of uniqueFiles) {
    await new Promise((resolve, reject) => {
      fs.createReadStream(file)
        .pipe(csvParser())
        .on("data", (row) => {
          const e = pickEmailFromRow(row);
          if (e && e.includes("@")) emails.add(e);
        })
        .on("end", resolve)
        .on("error", reject);
    });
  }

  const list = Array.from(emails);
  if (!list.length) return { files: uniqueFiles.length, emails: 0, deleted: 0 };

  const res = await musicianModel.deleteMany({ email: { $in: list } });
  return { files: uniqueFiles.length, emails: list.length, deleted: res?.deletedCount || 0 };
}
// ----------------------------- import runner ------------------------------
async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ connected");

  let total = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let rowErrors = 0;

  const t0 = Date.now();
  const LOG_EVERY = Math.max(parseInt(process.env.IMPORT_LOG_EVERY || "50", 10) || 50, 1);
  const skippedOut = process.env.IMPORT_SKIPPED_OUT || `scripts/import_skipped_${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
  let skippedWritten = 0;
  let skippedStream = null;

  // We MUST NOT close the connection until all async row work finishes.
  // This pattern pauses the stream, awaits DB work, then resumes.
  let inFlight = Promise.resolve();

  const stream = fs.createReadStream(CSV_PATH).pipe(csvParser());

  stream.on("data", (row) => {
    total += 1;
    stream.pause();

    inFlight = inFlight
      .then(async () => {
        const doc = buildFromRow(row);
        if (!doc) {
          skipped += 1;
          // Write the skipped row to a JSONL file for later review (best-effort)
          try {
            if (!skippedStream) skippedStream = fs.createWriteStream(skippedOut, { flags: "a" });
            skippedStream.write(JSON.stringify({ reason: "missing_email_or_tag_row", row }) + "\n");
            skippedWritten += 1;
          } catch {}
          return;
        }

        // Upsert by email, but DO NOT overwrite passwords if user already registered
        const existing = await musicianModel
          .findOne({ email: doc.email })
          .select("_id password hasSetPassword")
          .lean();

        if (!existing) {
          await musicianModel.create(doc);
          created += 1;
          if (total % LOG_EVERY === 0) {
            console.log(`📥 [import] progress total=${total} created=${created} updated=${updated} skipped=${skipped} rowErrors=${rowErrors}`);
          }
          return;
        }

        // Update only “safe” fields; don’t clobber password/hasSetPassword
        const $set = {};
        const safeKeys = [
          "firstName",
          "lastName",
          "phone",
          "basicInfo",
          "instrumentation",
          "vocals",
          "other_skills",
          "logistics",
          "bio",
          "functionBandVideoLinks",
          "social_media_links",
          "address",
          "role",
          "status",
          "mustChangePassword",
        ];
        for (const k of safeKeys) $set[k] = doc[k];

        await musicianModel.updateOne(
          { _id: existing._id },
          {
            $set,
            $setOnInsert: { email: doc.email },
          }
        );
        updated += 1;
        if (total % LOG_EVERY === 0) {
          console.log(`📥 [import] progress total=${total} created=${created} updated=${updated} skipped=${skipped} rowErrors=${rowErrors}`);
        }
      })
      .catch((e) => {
        rowErrors += 1;
        console.error("row error:", e?.message || e);
      })
      .finally(() => {
        stream.resume();
      });
  });

  await new Promise((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
  });

  console.log(`📥 [import] csv_end total=${total} created=${created} updated=${updated} skipped=${skipped} rowErrors=${rowErrors} skippedWritten=${skippedWritten} out=${skippedOut}`);

  // Close skipped output stream if opened
  if (skippedStream) {
    await new Promise((r) => skippedStream.end(r));
  }

  // Wait for the last paused row to finish
  await inFlight;

  // Optional: prune unsubscribes/cleaned lists from the musician DB
  let pruneReport = null;
  if (PRUNE_FILES.length) {
    console.log(`🧹 [prune] starting… files=${PRUNE_FILES.length}`);
    try {
      pruneReport = await pruneFromCsvFiles(PRUNE_FILES);
      console.log("🧹 [prune] complete:", pruneReport);
    } catch (e) {
      console.error("🧹 [prune] error:", e?.message || e);
      pruneReport = { error: e?.message || String(e) };
    }
  }

  console.log({ total, created, updated, skipped, rowErrors, skippedWritten, skippedOut, pruneReport, ms: Date.now() - t0 });
  await mongoose.disconnect();
  console.log("✅ done");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});