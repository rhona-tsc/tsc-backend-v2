// backend/controllers/availabilityControllerV2.js
import Act from "../models/actModel.js";
import Musician from "../models/musicianModel.js"; // optional, used as fallback for email
import AvailabilityModel from "../models/availabilityModel.js";
import { enqueueUnique, kickQueue, releaseLockAndProcessNext } from "./helpers.js";
import { toE164, sendWhatsAppText } from "../utils/twilioClient.js";
import { computeMemberMessageFee } from "./helpersForCorrectFee.js";
import { createCalendarInvite, updateCalendarEvent } from "../controllers/googleController.js";
import { applyFeaturedBadgeOnYesV2 } from "./applyFeaturedBadgeOnYesV2.js";
import { handleLeadNegativeReply, notifyDeputyOneShot } from "./availabilityHelpers.js"; 

const isLeadVocalRole = (role = "") =>
  ["lead vocal", "lead male vocal", "lead female vocal", "vocalist-guitarist"].includes(
    String(role || "").toLowerCase().trim()
  );

const firstNameOf = (p) =>
  String(p?.firstName || p?.givenName || p?.name || "there").split(/\s+/)[0];

const formatWithOrdinal = (dateLike) => {
    console.log(`🔵 (controllers/availabilityControllerV2.js) formatWithOrdinal START at ${new Date().toISOString()}`, {
    actId: params?.updated?.actId,
    dateISO: params?.updated?.dateISO,
    phone: params?.updated?.phone || params?.fromRaw,
  });
  const d = new Date(dateLike);
  if (isNaN(d)) return String(dateLike || "");
  const day = d.getDate();
  const j = day % 10,
    k = day % 100;
  const suf =
    j === 1 && k !== 11 ? "st" : j === 2 && k !== 12 ? "nd" : j === 3 && k !== 13 ? "rd" : "th";
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long" });
  const month = d.toLocaleDateString("en-GB", { month: "short" });
  return `${weekday}, ${day}${suf} ${month} ${d.getFullYear()}`;
};

const shortAddressOf = (address = "") =>
  String(address || "").split(",").slice(-2).join(",").replace(/,\s*UK$/i, "").trim();

export async function triggerLeadAvailabilityV2(req, res) {
  console.log(`🔵 (controllers/availabilityControllerV2.js) [triggerLeadAvailabilityV2] START at ${new Date().toISOString()}`, {
    actId: params?.updated?.actId,
    dateISO: params?.updated?.dateISO,
    phone: params?.updated?.phone || params?.fromRaw,
  });
  try {
    const { actId, lineupId, date, address } = req.body || {};
    if (!actId || !date || !address) {
      return res.status(400).json({ success: false, message: "Missing actId/date/address" });
    }

    const act = await Act.findById(actId).lean();
    if (!act) return res.status(404).json({ success: false, message: "Act not found" });

    const dateISO = new Date(date).toISOString().slice(0, 10);
    const dateText = formatWithOrdinal(date);
    const area = shortAddressOf(address);
    const actName = act.tscName || act.name || "the band";

    const lineup =
      act.lineups?.find(
        (l) =>
          String(l._id) === String(lineupId) || String(l.lineupId) === String(lineupId)
      ) || act.lineups?.[0];

    const leads = (lineup?.bandMembers || []).filter((m) => isLeadVocalRole(m.instrument));
    if (!leads.length) {
      return res.json({ success: true, sent: 0, note: "No lead vocalists in this lineup." });
    }

    console.log("[V2] triggerLeadAvailabilityV2 start", {
      actId,
      lineupId: lineupId || (lineup?._id || lineup?.lineupId) || null,
      dateISO,
      area,
      actName,
      leads: leads.length,
    });

    for (const lead of leads) {
      console.log("[V2] loop lead", {
        name: `${lead.firstName || ""} ${lead.lastName || ""}`.trim(),
        instrument: lead.instrument,
        rawPhone: lead.phoneNumber || lead.phone || "",
      });

      const phone = toE164(lead.phoneNumber || lead.phone || "");
      if (!phone) continue;
      console.log("[V2] using phone", phone);

      let fee = 0;
      try {
        fee = await computeMemberMessageFee({
          act,
          lineup,
          member: lead,
          address,
          dateISO,
        });
        console.log("[V2] computed fee", { phone, fee });
      } catch (err) {
        console.warn("[V2] fee compute failed; defaulting to 0", err?.message || err);
      }

      const variables = {
        "1": firstNameOf(lead),
        "2": dateText,
        "3": area,
        "4": String(fee),
        "5": lead.instrument || "Lead Vocal",
        "6": actName,
      };

      // --- SKIP if we already have a pending (unreplied) ping for this phone+act+date ---

const pending = await AvailabilityModel.findOne({
  actId,
  dateISO,
  phone,
  v2: true,
  // Not cancelled/expired, and no reply yet
  $or: [{ reply: null }, { reply: { $exists: false } }],
  status: { $nin: ["cancelled", "expired"] },
}).sort({ createdAt: -1 }).lean();

if (pending) {
  console.log("[V2] skip duplicate lead ping – awaiting reply", {
    actId, dateISO, phone, existingId: String(pending._id)
  });
  continue; // <-- do NOT upsert or enqueue a second time
}

      // Upsert a lightweight Availability row (V2 namespace)
      await AvailabilityModel.findOneAndUpdate(
        { actId, dateISO, phone, v2: true },
        {
          $setOnInsert: {
            enquiryId: Date.now().toString(),
            actId,
            lineupId: lineup?._id || lineup?.lineupId || null,
            musicianId: lead?.musicianId || lead?._id || null,
            phone,
            duties: lead.instrument || "Lead Vocal",
            formattedDate: dateText,
            formattedAddress: area,
            fee: String(fee),
            reply: null,
            inbound: {},
            v2: true,
            createdAt: new Date(),
            actName,
            musicianName: `${lead.firstName || ""} ${lead.lastName || ""}`.trim(),
            contactName: firstNameOf(lead),
            dateISO,
          },
          $set: {
            updatedAt: new Date(),
            status: "queued",
          },
        },
        { upsert: true }
      );
      console.log("[V2] availability upserted", { phone, actId, dateISO });

      // Enqueue (dedupes: phone+kind+actId+dateISO+addressShort)
      const smsBody = `Hi ${variables["1"]}, you've received an enquiry for ${variables["2"]} in ${variables["3"]} at a rate of £${variables["4"]} for ${variables["5"]} with ${variables["6"]}. Reply YES or NO.`;

      const { enqueued, skippedReason } = await enqueueUnique({
        phone,
        kind: "availability",
        payload: {
          actId,
          dateISO,
          address,
          addressShort: area,
          variables, // exact "1".."6"
          smsBody,
        },
      });

      console.log("[V2] enqueue result", { phone, enqueued, skippedReason });

      // Kick the queue for this phone (honours lock)
      await kickQueue(phone);
    }

    return res.json({ success: true });
  } catch (e) {
    console.error("[V2] triggerLeadAvailabilityV2 error:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}



export async function twilioStatusV2(req, res) {
    console.log(`🔵 (controllers/availabilityControllerV2.js) [twilioStatusV2] START at ${new Date().toISOString()}`, {
    actId: params?.updated?.actId,
    dateISO: params?.updated?.dateISO,
    phone: params?.updated?.phone || params?.fromRaw,
  });
  try {
    const sidRaw = req.body?.MessageSid || req.body?.SmsSid || req.body?.MessageSid;
    const statusRaw = req.body?.MessageStatus || req.body?.SmsStatus || "";
    const channel = (req.body?.ChannelPrefix || "").toLowerCase(); // "whatsapp" for WA callbacks
    const status = String(statusRaw || "").toLowerCase();
    const sid = String(sidRaw || "").trim();

    console.log("[V2] status:", { sid, status, channel });

    // Delivery failures are handled by the main Twilio status endpoint, which
    // records the failure and emails the admin. Never change channel to SMS.
    const isWA =
      channel === "whatsapp" || (req.body?.From || "").toString().startsWith("whatsapp:");
    if (isWA && sid && (status === "undelivered" || status === "failed")) {
      console.warn("[V2] WhatsApp delivery failed; no SMS fallback", { sid, status });
    }
  } catch (e) {
    console.warn("[V2] twilioStatusV2 error:", e?.message || e);
  }
  res.status(200).send("<Response/>");
}
