// controllers/availabilityController.js
import ActAvailability from "../models/actModel.js";

export async function getAvailableActIds(req, res) {
  try {
    const dateISO = String(req.query.date||"").slice(0,10);
    if (!dateISO) return res.json({ actIds: [] });

    const rows = await ActAvailability
      .find({ dateISO, status: "available" })
      .select({ actId: 1 })
      .lean();

    const actIds = Array.from(new Set(rows.map(r => String(r.actId))));
    res.json({ actIds });
  } catch (e) {
    console.warn("getAvailableActIds failed:", e?.message || e);
    res.json({ actIds: [] });
  }
}