import { sendWhatsAppMessage } from '../utils/twilioClient.js';
import Act from '../models/actModel.js';
import User from '../models/userModel.js';
import { sendSMSMessage } from "../utils/twilioClient.js";


// ⬇️ Import the helper that writes to the Enquiry Board
import { upsertEnquiryRowFromShortlist } from './bookingController.js';
import { createCalendarInvite } from './googleController.js';

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
    const { userId, actId, lineupId, selectedDate, selectedAddress, selectedCounty, source, maxBudget, notes, enquiryRef } = req.body;

    if (!userId || !actId) {
      return res.status(400).json({ success: false, message: "Missing userId or actId" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (!user.shortlistedActs.includes(actId)) {
      user.shortlistedActs.push(actId);
      await user.save();
      await Act.findByIdAndUpdate(actId, { $inc: { timesShortlisted: 1 } });
    }

    const act = await Act.findById(actId).lean();
    const lineup = Array.isArray(act?.lineups)
      ? act.lineups.find(l => String(l?._id) === String(lineupId) || String(l?.lineupId) === String(lineupId))
      : null;

    const base = Number(lineup?.base_fee?.[0]?.total_fee || 0);
    const county = selectedCounty || (selectedAddress?.split(",").slice(-2)[0]?.trim() || "");
    const potentialGross = base ? Math.ceil(base / 0.75) : 0;

    console.log("📋 Enquiry upsert payload", {
  actName: act?.tscName,
  selectedLineup: lineup?._id,
  selectedDate,
  address: selectedAddress,
  county,
  user: { id: user._id, firstName: user.firstName, lastName: user.lastName },
});

    await upsertEnquiryRowFromShortlist({
      actName: act?.tscName || act?.name || "",
      selectedLineup: lineup || null,
      selectedDate: selectedDate || null,
      address: selectedAddress || "",
      county,
      source: source || "Direct",
      notes: notes || "",
      enquiryRef: enquiryRef || undefined,
      potentialGross,
      status: "open",
    });

    // 🔔 Send WhatsApp availability to vocalists
// 🔔 Send WhatsApp availability to vocalists
const vocalists = (lineup?.bandMembers || []).filter(m =>
  /(vocal|singer)/i.test(m.instrument || "")
);

for (const v of vocalists) {
const rawPhone = v.phone || v.phoneNumber || v.phoneNormalized || "";
const phone = rawPhone
  ? rawPhone.startsWith("+")
    ? rawPhone.replace(/\s+/g, "")
    : `+44${rawPhone.replace(/^0/, "").replace(/\s+/g, "")}`
  : null;

  if (!user.lastName) user.lastName = "Unknown";

console.log("🎤 Checking vocalist contact →", {
  name: `${v.firstName || ""} ${v.lastName || ""}`.trim(),
  instrument: v.instrument || "",
  rawPhone,
  formattedPhone: phone,
  email: v.email || null,
});
if (!phone) {
  console.warn(`⚠️ Skipping ${v.firstName || "Unknown"} — invalid or missing phone number`);
  continue;
}

  console.log("🎤 Checking vocalist contact →", {
    name: `${v.firstName || ""} ${v.lastName || ""}`.trim(),
    instrument: v.instrument || "",
    rawPhone: v.phone || null,
    formattedPhone: phone || null,
    email: v.email || null,
  });

  if (!v.phone) {
    console.warn(`⚠️ Skipping ${v.firstName || "Unknown"} — no phone number found`);
    continue;
  }

  try {
    await sendWhatsAppMessage({
      to: phone,
      contentSid: process.env.TWILIO_ENQUIRY_SID,
      variables: {
        1: v.firstName || "Musician",
        2: new Date(selectedDate).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric" }),
        3: selectedAddress,
        4: act?.tscName || act?.name || "",
      },
    });
    console.log("📤 Enquiry WhatsApp sent to", phone);
  } catch (waErr) {
    console.warn("⚠️ WA enquiry failed, trying SMS:", waErr.message);
    if (phone)
      await sendSMSMessage(phone, `Availability check: ${act?.tscName || act?.name} on ${selectedDate} at ${selectedAddress}`);
  }

  // Calendar hold (optional)
  if (v.email && selectedDate) {
    try {
      await createCalendarInvite({
        actId,
        dateISO: selectedDate,
        email: v.email,
        summary: `TSC: Enquiry – ${act?.tscName}`,
        description: `Enquiry: ${selectedAddress}`,
        extendedProperties: { line: `Availability check for ${act?.tscName}` },
      });
    } catch (calErr) {
      console.warn("⚠️ Calendar invite skipped:", calErr.message);
    }
  }
}

    for (const v of vocalists) {
      const phone = v.phone?.startsWith("+") ? v.phone : `+44${v.phone?.replace(/^0/, "")}`;
      try {
        await sendWhatsAppMessage({
          to: phone,
          contentSid: process.env.TWILIO_ENQUIRY_SID,
          variables: {
            1: v.firstName || "Musician",
            2: new Date(selectedDate).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric" }),
            3: selectedAddress,
            4: act?.tscName || act?.name || "",
          },
        });
        console.log("📤 Enquiry WhatsApp sent to", phone);
      } catch (waErr) {
        console.warn("⚠️ WA enquiry failed, trying SMS:", waErr.message);
        if (phone)
          await sendSMSMessage(phone, `Availability check: ${act?.tscName || act?.name} on ${selectedDate} at ${selectedAddress}`);
      }

      // Calendar hold (optional)
      if (v.email && selectedDate) {
        try {
          await createCalendarInvite({
            actId,
            dateISO: selectedDate,
            email: v.email,
            summary: `TSC: Enquiry – ${act?.tscName}`,
            description: `Enquiry: ${selectedAddress}`,
            extendedProperties: { line: `Availability check for ${act?.tscName}` },
          });
        } catch (calErr) {
          console.warn("⚠️ Calendar invite skipped:", calErr.message);
        }
      }
    }

    console.log("✅ Shortlist + enquiry notifications complete");
    return res.json({ success: true });
  } catch (err) {
    console.error("❌ shortlistActAndTrack error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};