
import ActAvailability from "../models/actModel.js";

/* -------------------------------------------------------------------------- */
/*                          getAvailableActIds                                */
/* -------------------------------------------------------------------------- */
export async function getAvailableActIds(req, res) {
  console.log(`🌳 (controllers/actAvailabilityController.js) getAvailableActIds called at`, new Date().toISOString(), {
    query: req.query,
  });

  try {
    const dateISO = String(req.query.date || "").slice(0, 10);
    if (!dateISO) {
      console.warn(`🌳 getAvailableActIds missing or invalid date`);
      return res.json({ actIds: [] });
    }

    console.log(`🌳 getAvailableActIds fetching rows`, { dateISO });

    const rows = await ActAvailability
      .find({ dateISO, status: "available" })
      .select({ actId: 1 })
      .lean();

    console.log(`🌳 getAvailableActIds query result`, { rowCount: rows.length });

    const actIds = Array.from(new Set(rows.map(r => String(r.actId))));

    console.log(`🌳 getAvailableActIds returning`, { count: actIds.length, actIds });

    res.json({ actIds });
  } catch (e) {
    console.warn(`🌳 getAvailableActIds failed`, e?.message || e);
    res.json({ actIds: [] });
  }
}