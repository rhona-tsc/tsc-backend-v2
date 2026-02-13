// exportActsMerchantFeed.js
// Run with: mongosh "<MONGODB_URI>" --file exportActsMerchantFeed.js

const fs = require("fs");

// --- CONFIG ---
const OUTFILE = "acts_merchant_feed.tsv";
const BRAND = "The Supreme Collective";
const AVAILABILITY = "in_stock";
const ACT_URL = (slug) =>
  `https://thesupremecollective.co.uk/act/${encodeURIComponent(slug || "")}`;

const HIGHLIGHTS = [
  "Up to 3x40mins or 2x60mins live performance",
  "PA & lighting included",
  "Background music playlist included",
  "Fully tailored setlists",
  "We'll learn your first dance",
];

// --- Helpers ---
const tsvEscape = (v) => {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\t/g, " ").replace(/\r?\n/g, " ").trim();
};

const moneyGBP = (n) => {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return "";
  return `${num.toFixed(2)} GBP`;
};

// --- Headers ---
const headers = [
  "id",
  "title",
  "description",
  "availability",
  "link",
  "mobile_link",
  "image_link",
  "price",
  "brand",
  "identifier_exists",
  ...HIGHLIGHTS.map((_, i) => `product_highlight_${i + 1}`),
];

const rows = [];
rows.push(headers.join("\t"));

// --- Detect collection ---
const names = db.getCollectionNames();
const pick =
  (names.includes("acts") && "acts") ||
  (names.includes("act") && "act") ||
  null;

if (!pick) {
  print("❌ Could not find 'acts' or 'act' collection. Collections are:");
  printjson(names);
  quit(1);
}

const coll = db.getCollection(pick);
const total = coll.countDocuments();
print(`ℹ️ Using collection: ${pick} (total docs: ${total})`);

// --- Show status distribution (helpful debugging) ---
print("ℹ️ Status distribution:");
try {
  const dist = coll
    .aggregate([
      { $group: { _id: "$status", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ])
    .toArray();
  printjson(dist);
} catch (e) {
  print("⚠️ Could not aggregate status distribution:");
  print(e.message);
}

// --- Query (export live-ish) ---
// Add any others you use in production:
const allowedStatuses = ["live", "approved", "Approved, changes pending"];

let query = { status: { $in: allowedStatuses } };
let matchCount = coll.countDocuments(query);

if (matchCount === 0) {
  print(
    `⚠️ 0 docs matched status in ${JSON.stringify(
      allowedStatuses
    )}. Falling back to exporting ALL docs.`
  );
  query = {};
  matchCount = coll.countDocuments(query);
}

print(`ℹ️ Exporting ${matchCount} docs...`);

const projection = {
  _id: 1,
  tscName: 1,
  tscDescription: 1,
  slug: 1,
  coverImage: 1,
  minDisplayPrice: 1,
  status: 1,
};

let count = 0;

coll.find(query, projection).forEach((act) => {
  const id = String(act._id || "");
  const title = act.tscName || "";
  const description = act.tscDescription || "";
  const slug = act.slug || "";

  const image_link =
    Array.isArray(act.coverImage) && act.coverImage[0] && act.coverImage[0].url
      ? act.coverImage[0].url
      : "";

  const link = ACT_URL(slug);
  const mobile_link = link;

  const price = moneyGBP(act.minDisplayPrice);

  const row = [
    id,
    title,
    description,
    AVAILABILITY,
    link,
    mobile_link,
    image_link,
    price,
    BRAND,
    "no", // identifier_exists = no
    ...HIGHLIGHTS,
  ].map(tsvEscape);

  rows.push(row.join("\t"));
  count += 1;
});

fs.writeFileSync(OUTFILE, rows.join("\n"), "utf8");
print(`✅ Wrote ${count} rows to ${OUTFILE}`);