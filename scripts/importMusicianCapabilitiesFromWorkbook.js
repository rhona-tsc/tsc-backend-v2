import path from "node:path";
import process from "node:process";
import ExcelJS from "exceljs";
import mongoose from "mongoose";
import musicianModel from "../models/musicianModel.js";

const args = new Set(process.argv.slice(2));
const commit = args.has("--commit");
const fileArgIndex = process.argv.indexOf("--file");
const workbookPath =
  fileArgIndex >= 0 ? process.argv[fileArgIndex + 1] : process.env.MUSICIAN_IMPORT_FILE;

if (!workbookPath) throw new Error("Pass --file /absolute/path/to/workbook.xlsx");
if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");

const KNOWN_TAGS = new Set([
  "Electric Bass", "Acoustic Bass", "Double Bass", "Electric Guitar",
  "Acoustic Guitar", "Banjo", "Drums", "Cajon", "Electric Drum Kit",
  "Trigger Pad", "SPD-SX", "Keys", "Saxophone", "Trumpet", "Trombone",
  "Female Lead Vocalist", "Male Lead Vocalist", "Male Lead Vocalist-Guitarist",
  "DJ", "Can DJ with laptop and mixer", "PA", "Lights", "Transport",
  "Happy To Take Another Band Member", "IEMS", "Backing Vocals",
]);

const cleanEmail = (value) => String(value || "").trim().toLowerCase();
const cleanTags = (value) => Array.from(new Set(String(value || "")
  .split(",").map((tag) => tag.trim()).filter((tag) => KNOWN_TAGS.has(tag))));
const hasLegacySkill = (skills, pattern) =>
  (Array.isArray(skills) ? skills : []).some((skill) => pattern.test(String(skill)));

await mongoose.connect(process.env.MONGODB_URI);

try {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.resolve(workbookPath));
  const sheet = workbook.getWorksheet("Form Responses 1");
  if (!sheet) throw new Error('Worksheet "Form Responses 1" was not found');

  // Later rows win for duplicate email addresses; nothing is keyed by name.
  const spreadsheetByEmail = new Map();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < 3) return;
    const email = cleanEmail(row.getCell(2).text);
    if (!email) return;
    spreadsheetByEmail.set(email, {
      rowNumber,
      tags: cleanTags(row.getCell(6).text),
    });
  });

  const dbMusicians = await musicianModel.find(
    { role: "musician", email: { $in: [...spreadsheetByEmail.keys()] } },
    { email: 1, other_skills: 1, capabilities: 1 },
  ).lean();

  const dbByEmail = new Map(dbMusicians.map((m) => [cleanEmail(m.email), m]));
  const report = { mode: commit ? "commit" : "dry-run", matched: 0, updated: 0, skippedNotInDatabase: 0, changes: [] };

  for (const [email, source] of spreadsheetByEmail) {
    const musician = dbByEmail.get(email);
    if (!musician) {
      report.skippedNotInDatabase += 1;
      continue;
    }
    report.matched += 1;

    const ownsPa = source.tags.includes("PA");
    const ownsLights = source.tags.includes("Lights");
    const legacyCombined = hasLegacySkill(musician.other_skills, /sound engineering with pa\s*&\s*lights/i);
    const legacyPa = hasLegacySkill(musician.other_skills, /\bpa\b|pa provision/i);
    const legacyLights = hasLegacySkill(musician.other_skills, /lights? provision|pa\s*&\s*lights/i);

    const paProvision = musician.capabilities?.paProvision === true || ownsPa || legacyPa;
    const lightingProvision = musician.capabilities?.lightingProvision === true || ownsLights || legacyCombined || legacyLights;
    const soundEngineering = musician.capabilities?.soundEngineering === true || paProvision;
    const lightingProvisionNeedsCheck = paProvision && !lightingProvision;

    const additions = [
      soundEngineering ? "Sound Engineering" : "",
      paProvision ? "PA Provision" : "",
      lightingProvision ? "Lighting Provision" : "",
    ].filter(Boolean);
    const otherSkills = Array.from(new Set([...(musician.other_skills || []), ...additions]));

    const update = {
      capabilities: { soundEngineering, paProvision, lightingProvision, lightingProvisionNeedsCheck },
      other_skills: otherSkills,
      legacyImport: {
        source: "Musician Applications (Responses).xlsx",
        mailchimpTags: source.tags,
        importedAt: new Date(),
      },
    };

    report.updated += 1;
    report.changes.push({ email, sourceRow: source.rowNumber, ...update.capabilities });
    if (commit) await musicianModel.updateOne({ _id: musician._id }, { $set: update });
  }

  console.log(JSON.stringify(report, null, 2));
} finally {
  await mongoose.disconnect();
}
