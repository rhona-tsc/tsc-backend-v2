// routes/debugRoutes.js
import express from "express";
import Musician from "../models/musicianModel.js";
const router = express.Router();

router.get("/musician-id", async (req, res) => {
  try {
    const { email, phone } = req.query;
    if (!email && !phone) {
      return res.status(400).json({ ok: false, msg: "Provide ?email= or ?phone=" });
    }

    // normalize UK phones to E.164-ish
    const norm = (v="")=>{
      const s = String(v).replace(/^whatsapp:/i,"").replace(/\s+/g,"");
      if (!s) return "";
      if (s.startsWith("+")) return s;
      if (s.startsWith("07")) return s.replace(/^0/, "+44");
      if (s.startsWith("44")) return `+${s}`;
      return s;
    };

    const criteria = email
      ? { email: String(email).toLowerCase() }
      : { $or: [{ phoneNormalized: norm(phone) }, { phone: norm(phone) }, { phoneNumber: norm(phone) }] };

    const mus = await Musician.findOne(criteria).select("_id firstName lastName email phone phoneNormalized").lean();
    return res.json({ ok: true, musician: mus });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});

export default router;