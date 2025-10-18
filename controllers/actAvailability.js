// backend/controllers/actAvailability.js
import Act from "../models/actModel.js";

/* -------------------------------------------------------------------------- */
/*                            logActAvailability                              */
/* -------------------------------------------------------------------------- */
/**
 * Upsert an availability decision on the Act for a specific date.
 * We keep one entry per day; the latest decision wins.
 */
export async function logActAvailability({ actId, dateISO, status, setBy = {}, note = "" }) {
  console.log(`🌸 (controllers/actAvailability.js) logActAvailability called at`, new Date().toISOString(), {
    actId,
    dateISO,
    status,
    setBy,
    note,
  });

  if (!actId || !dateISO || !status) {
    console.warn(`🌸 logActAvailability missing required fields`, { actId, dateISO, status });
    throw new Error("actId/dateISO/status required");
  }

  const day = String(dateISO).slice(0, 10);
  console.log(`🌸 logActAvailability normalized date`, { day });

  try {
    // Remove any existing entry for the same day
    await Act.updateOne({ _id: actId }, { $pull: { availabilityByDate: { dateISO: day } } });
    console.log(`🌸 logActAvailability removed previous entries`, { actId, day });

    const entry = {
      dateISO: day,
      status, // "available" | "unavailable"
      setAt: new Date(),
      setBy: {
        musicianId: String(setBy.musicianId || ""),
        name: String(setBy.name || ""),
        phone: String(setBy.phone || ""),
        channel: String(setBy.channel || "whatsapp"),
      },
      note: String(note || ""),
    };

    const result = await Act.updateOne({ _id: actId }, { $push: { availabilityByDate: entry } });
    console.log(`🌸 logActAvailability entry added`, { actId, status, dateISO, result });
    return result;
  } catch (err) {
    console.error(`🌸 logActAvailability error`, err?.message || err);
    throw err;
  }
}

/* -------------------------------------------------------------------------- */
/*                        getActAvailabilityForDate                           */
/* -------------------------------------------------------------------------- */
export async function getActAvailabilityForDate(actId, dateISO) {
  console.log(`🌸 (controllers/actAvailability.js) getActAvailabilityForDate called at`, new Date().toISOString(), {
    actId,
    dateISO,
  });

  const day = String(dateISO).slice(0, 10);
  console.log(`🌸 getActAvailabilityForDate normalized date`, { day });

  try {
    const doc = await Act.findOne({
      _id: actId,
      availabilityByDate: { $elemMatch: { dateISO: day } },
    })
      .select("availabilityByDate.$")
      .lean();

    const result = doc?.availabilityByDate?.[0] || null;
    console.log(`🌸 getActAvailabilityForDate result`, { actId, dateISO, found: !!result });
    return result;
  } catch (err) {
    console.error(`🌸 getActAvailabilityForDate error`, err?.message || err);
    throw err;
  }
}