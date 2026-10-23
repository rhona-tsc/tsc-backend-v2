import "dotenv/config";
import mongoose from "mongoose";
import Musician from "../models/musicianModel.js";
import Act from "../models/actModel.js";

const fees = {
  Bedfordshire: 130, Berkshire: 164, Buckinghamshire: 160, Cambridgeshire: 164,
  Carmarthenshire: 306, "Central Scotland": 406, Ceredigion: 152, Cheshire: 24,
  Cleveland: 180, Conway: 102, Cornwall: 420, Cumbria: 164, Denbighshire: 84,
  Derbyshire: 46, Devon: 360, Dorset: 340, Durham: 314, "East Sussex": 368,
  Essex: 316, Flintshire: 82, Gloucestershire: 112, "Greater London": 191,
  "Greater Manchester": 52, Gwynedd: 112, Hampshire: 312, Herefordshire: 114,
  Hertfordshire: 162, Kent: 336, Lancashire: 96, Leicestershire: 88,
  Lincolnshire: 120, "London Central": 341, Merseyside: 90, "Mid Glamorgan": 304,
  Middlesex: 178, Monmouthshire: 150, Norfolk: 296, "North Humberside": 292,
  "North Scotland": 556, "North Yorkshire": 160, Northamptonshire: 116,
  Northumberland: 354, Nottinghamshire: 90, Oxfordshire: 122, Pembrokeshire: 330,
  Powys: 132, Rutland: 96, Shropshire: 50, Somerset: 300,
  "South Glamorgan": 296, "South Humberside": 150, "South Scotland": 174,
  "South Yorkshire": 96, Staffordshire: 14, Suffolk: 316, Surrey: 314,
  "Tyne and Wear": 320, Warwickshire: 88, "West Glamorgan": 308,
  "West Midlands": 48, "West Sussex": 346, "West Yorkshire": 106,
};

const email = "rachelfsinger@hotmail.com";
const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) throw new Error("Missing MongoDB connection string");

await mongoose.connect(uri);
try {
  const musician = await Musician.findOneAndUpdate(
    { email: new RegExp(`^${email}$`, "i") },
    { $set: { countyTravelFees: fees } },
    { new: true },
  ).lean();
  if (!musician) throw new Error("Rachel Francis musician profile not found");

  const result = await Act.updateMany(
    { "lineups.bandMembers.email": new RegExp(`^${email}$`, "i") },
    { $set: { "lineups.$[].bandMembers.$[member].countyTravelFees": fees } },
    { arrayFilters: [{ "member.email": new RegExp(`^${email}$`, "i") }] },
  );

  console.log(JSON.stringify({
    musicianId: String(musician._id),
    countyCount: Object.keys(fees).length,
    matchedActs: result.matchedCount,
    updatedActs: result.modifiedCount,
  }));
} finally {
  await mongoose.disconnect();
}
