// backend/controllers/actAvailability.js
import Act from "../models/actModel.js";

/**
 * Upsert an availability decision on the Act for a specific date.
 * We keep one entry per day; the latest decision wins.
 */
export async function logActAvailability({ actId, dateISO, status, setBy = {}, note = "" }) {
  if (!actId || !dateISO || !status) throw new Error("actId/dateISO/status required");
  const day = String(dateISO).slice(0, 10);

  // Remove any existing entry for the day, then push the fresh one.
  await Act.updateOne({ _id: actId }, { $pull: { availabilityByDate: { dateISO: day } } });

  const entry = {
    dateISO: day,
    status,                       // "available" | "unavailable"
    setAt: new Date(),
    setBy: {
      musicianId: String(setBy.musicianId || ""),
      name:       String(setBy.name || ""),
      phone:      String(setBy.phone || ""),
      channel:    String(setBy.channel || "whatsapp"),
    },
    note: String(note || ""),
  };

  return Act.updateOne({ _id: actId }, { $push: { availabilityByDate: entry } });
}

export async function getActAvailabilityForDate(actId, dateISO) {
  const day = String(dateISO).slice(0, 10);
  const doc = await Act.findOne({
    _id: actId,
    availabilityByDate: { $elemMatch: { dateISO: day } },
  })
    .select("availabilityByDate.$")
    .lean();
  return doc?.availabilityByDate?.[0] || null;
}