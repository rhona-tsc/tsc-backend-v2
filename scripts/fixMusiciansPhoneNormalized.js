// Run:
// mongosh "<MONGODB_URI>" --file scripts/fixMusiciansPhoneNormalized.js

const col = db.getCollection("musicians");

// 1) Show a few examples BEFORE
print("\nBEFORE examples:");
printjson(
  col.find(
    { phoneNormalized: { $type: "string", $regex: "\\s" } },
    { _id: 1, email: 1, phone: 1, phoneNumber: 1, phoneNormalized: 1 }
  ).limit(5).toArray()
);

// 2) Remove whitespace from phoneNormalized / phone / phoneNumber
// Uses an aggregation pipeline update (MongoDB 4.2+)
const res = col.updateMany(
  {},
  [
    {
      $set: {
        phoneNormalized: {
          $cond: [
            { $eq: [{ $type: "$phoneNormalized" }, "string"] },
            {
              $replaceAll: {
                input: { $trim: { input: "$phoneNormalized" } },
                find: " ",
                replacement: "",
              },
            },
            "$phoneNormalized",
          ],
        },
        phone: {
          $cond: [
            { $eq: [{ $type: "$phone" }, "string"] },
            {
              $replaceAll: {
                input: { $trim: { input: "$phone" } },
                find: " ",
                replacement: "",
              },
            },
            "$phone",
          ],
        },
        phoneNumber: {
          $cond: [
            { $eq: [{ $type: "$phoneNumber" }, "string"] },
            {
              $replaceAll: {
                input: { $trim: { input: "$phoneNumber" } },
                find: " ",
                replacement: "",
              },
            },
            "$phoneNumber",
          ],
        },
      },
    },
  ]
);

print("\nUPDATE RESULT:");
printjson(res);

// 3) Show a few examples AFTER
print("\nAFTER examples:");
printjson(
  col.find(
    { phoneNormalized: { $type: "string" } },
    { _id: 1, email: 1, phone: 1, phoneNumber: 1, phoneNormalized: 1 }
  ).limit(5).toArray()
);

print("\nDone.\n");