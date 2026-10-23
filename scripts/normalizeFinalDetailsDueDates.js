import "dotenv/config";
import mongoose from "mongoose";
import BookingBoardItem from "../models/bookingBoardItem.js";
import { finalDetailsDueISO } from "../utils/finalDetailsDueDate.js";

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
try {
  const rows = await BookingBoardItem.find({
    $or: [
      { eventDateISO: { $type: "string", $ne: "" } },
      { eventDate: { $exists: true, $ne: null } },
      { date: { $exists: true, $ne: null } },
    ],
  }).select("eventDateISO eventDate date bookingDateISO enquiryDateISO createdAt invoiceDueDateISO").lean();

  const operations = rows.flatMap((row) => {
    const due = finalDetailsDueISO(row);
    if (!due || due === row.invoiceDueDateISO) return [];
    return [{ updateOne: { filter: { _id: row._id }, update: { $set: { invoiceDueDateISO: due } } } }];
  });
  const result = operations.length
    ? await BookingBoardItem.bulkWrite(operations, { ordered: false })
    : { modifiedCount: 0 };
  console.log(JSON.stringify({ checked: rows.length, changed: result.modifiedCount || 0 }));
} finally {
  await mongoose.disconnect();
}
