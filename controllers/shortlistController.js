import { sendWhatsAppMessage } from '../utils/twilioClient.js';
import Act from '../models/actModel.js';
import User from '../models/userModel.js';
import { sendSMSMessage } from "../utils/twilioClient.js";


// ⬇️ Import the helper that writes to the Enquiry Board
import { upsertEnquiryRowFromShortlist } from './bookingController.js';

// --- phone helpers (keep in this file)
const normalizePhoneE164 = (raw = "") => {
  let s = String(raw || "").trim().replace(/^whatsapp:/i, "").replace(/\s+/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("07")) return s.replace(/^0/, "+44");
  if (s.startsWith("44")) return `+${s}`;
  return s;
};


export const notifyMusician = async (req, res) => {
  const { phone, message } = req.body;

  if (!phone || !message) {
    console.error("❌ Missing fields in request body:", req.body);
    return res.status(400).json({ success: false, message: "Phone or message missing" });
  }

  console.log("📞 Would send message to:", phone);
  console.log("📨 Message:", message);

  try {
    // Convert UK 07... numbers to +447... format for WhatsApp
await sendSMSMessage(phone, message);
   return res.status(200).json({ success: true, message: "SMS sent" });
  } catch (error) {
    console.error("❌ Error sending WhatsApp:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Shortlist an act for a user AND mirror a row into the Enquiry Board.
 * Expected body (in addition to your current fields):
 *  - lineupId (string)
 *  - selectedDate ("YYYY-MM-DD")
 *  - selectedAddress (string)
 *  - selectedCounty (string, optional if you can parse from address)
 *  - source (string, e.g. "Direct", "Encore")
 *  - maxBudget (number, optional)
 *  - notes (string, optional)
 *  - enquiryRef (string, optional)
 */
export const shortlistActAndTrack = async (req, res) => {
  try {
    const {
      userId,
      actId,

      // NEW optional fields to enrich the Enquiry Board row:
      lineupId,
      selectedDate,
      selectedAddress,
      selectedCounty,
      source,
      maxBudget,
      notes,
      enquiryRef,
    } = req.body;

    if (!userId || !actId) {
      return res.status(400).json({ success: false, message: 'Missing userId or actId' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    console.log("🔍 User found:", user._id, "Shortlisted acts before:", user.shortlistedActs);

    // Your existing shortlist storage
    if (!user.shortlistedActs.includes(actId)) {
      user.shortlistedActs.push(actId);
      await user.save();
      await Act.findByIdAndUpdate(actId, { $inc: { timesShortlisted: 1 } });
    }

    // ---- Mirror to Enquiry Board (idempotent-ish via enquiryRef if you pass one) ----
    try {
      const act = await Act.findById(actId).lean();

      // Try to find the selected lineup on the act
      const lineup = Array.isArray(act?.lineups)
        ? act.lineups.find(
            (l) =>
              String(l?._id) === String(lineupId) ||
              String(l?.lineupId) === String(lineupId)
          )
        : null;

      // Compute a display gross (base + essential add-ons, grossed up by 25% margin)
      let base = Number(lineup?.base_fee?.[0]?.total_fee || 0);
      const essentialAddOns = (lineup?.bandMembers || [])
        .flatMap((m) => (m.additionalRoles || []).filter((r) => r.isEssential && typeof r.additionalFee === 'number'))
        .reduce((sum, r) => sum + (r.additionalFee || 0), 0);
      base += essentialAddOns;
      const potentialGross = base > 0 ? Math.ceil(base / 0.75) : 0;

      // County: prefer explicit selectedCounty, else parse from address
      const county =
        selectedCounty ||
        (selectedAddress ? (selectedAddress.split(",").slice(-2)[0] || "").trim() : "");

      await upsertEnquiryRowFromShortlist({
        // Identifiers / naming
        actName: act?.name || act?.tscName || "",
        actTscName: act?.tscName || act?.name || "",

        // Lineup/date/location
        selectedLineup: lineup || null,
        selectedDate: selectedDate || null, // becomes eventDateISO
        address: selectedAddress || "",
        county,

        // Source + free text
        source: source || "Direct",
        agent: source || "Direct",
        notes: notes || "",
        enquiryRef: enquiryRef || undefined,

        // Money + quoted details
        potentialGross,
        maxBudget: maxBudget != null ? Number(maxBudget) : undefined,

        // Leave status open on first capture
        status: "open",
      });

      console.log("✅ EnquiryBoard upserted for shortlist:", {
        act: act?.tscName || act?.name,
        selectedDate,
        county,
        potentialGross,
      });
    } catch (mirrorErr) {
      // Non-fatal – still return success for the shortlist action
      console.warn("⚠️ Mirror to EnquiryBoard failed:", mirrorErr?.message || mirrorErr);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};