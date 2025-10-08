// backend/controllers/availabilityControllerV2.js
import Act from "../models/actModel.js";
import Musician from "../models/musicianModel.js"; // optional, used as fallback for email
import AvailabilityModel from "../models/availabilityModel.js";
import { enqueueUnique, kickQueue, releaseLockAndProcessNext } from "./helpers.js";
import { sendSMSMessage, toE164, WA_FALLBACK_CACHE, sendWhatsAppText } from "../utils/twilioClient.js";
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

export async function twilioInboundV2(req, res) {
  try {
    const body    = String(req.body?.Body || "");
    const btn     = String(req.body?.ButtonText || "");
    const payload = String(req.body?.ButtonPayload || "");
    const fromRaw = String(req.body?.WaId || req.body?.From || "").replace(/^whatsapp:/i, "");
    const from    = toE164(fromRaw);

    console.log("✅ Twilio inbound V2", { from, waId: req.body?.WaId, body, btn, payload });

    // Parse YES/NO
    const txt = `${btn} ${payload} ${body}`.trim().toLowerCase();
    const reply =
      /^(yes|y|available|i.?m available)\b/.test(txt) ? "yes" :
      /^(no|n|unavailable|i.?m not available)\b/.test(txt) ? "no" : null;

    if (!reply || !from) return res.status(200).send("<Response/>");

    // Update latest V2 Availability row for this phone
    const updated = await AvailabilityModel.findOneAndUpdate(
      { phone: from, v2: true },
      {
        $set: {
          reply,
          repliedAt: new Date(),
          updatedAt: new Date(),
          "inbound.sid": req.body?.MessageSid || req.body?.SmsSid || "",
          "inbound.body": body || "",
          "inbound.buttonText": btn || "",
          "inbound.buttonPayload": payload || "",
        },
      },
      { new: true, sort: { createdAt: -1 } }
    );

    if (!updated) return res.status(200).send("<Response/>");

    const act = updated.actId ? await Act.findById(updated.actId).lean() : null;

    // ---------------- YES ----------------
    if (reply === "yes") {
      // Apply featured badge (lead or deputy) ASAP
      try {
        await applyFeaturedBadgeOnYesV2({ updated, actDoc: act, musicianDoc: null, fromRaw });
      } catch (e) {
        console.warn("[V2] applyFeaturedBadgeOnYesV2 failed:", e?.message || e);
      }

      // Resolve email for calendar invite
      let musicianEmail = "";
      try {
        if (updated.actId) {
          const actDoc = act || (await Act.findById(updated.actId).lean());
          const lineup =
            (actDoc?.lineups || []).find(
              (l) => String(l._id) === String(updated.lineupId) || String(l.lineupId) === String(updated.lineupId)
            ) || null;
          const member =
            (lineup?.bandMembers || []).find(
              (bm) => String(bm?._id) === String(updated.musicianId) || String(bm?.musicianId) === String(updated.musicianId)
            ) || null;
          musicianEmail = member?.email || member?.emailAddress || "";
        }
        if (!musicianEmail && updated.musicianId) {
          const m = await Musician.findById(updated.musicianId).select("email").lean();
          musicianEmail = m?.email || "";
        }
      } catch {}

      const emailForInvite =
        (typeof musicianEmail === "string" && musicianEmail) ||
        updated?.calendarInviteEmail ||
        "";

      const dateISOday = String((updated?.dateISO || "").slice(0, 10));

      if (emailForInvite && dateISOday) {
        try {
          const desc =
            `TSC enquiry:\n` +
            `Act: ${updated?.actName || ""}\n` +
            `Role: ${updated?.duties || ""}\n` +
            `Rate: £${String(updated?.fee || "TBC")}\n` +
            `Address: ${updated?.formattedAddress || ""}\n` +
            `Date: ${updated?.formattedDate || updated?.dateISO || ""}\n` +
            `Date enquiry made: ${new Date(updated?.createdAt || Date.now()).toLocaleString("en-GB")}`;

          const event = await createCalendarInvite({
            enquiryId: updated.enquiryId || `ENQ_${Date.now()}`,
            actId: String(updated.actId || ""),
            dateISO: dateISOday, // YYYY-MM-DD
            email: emailForInvite,
            summary: "TSC: Enquiry",
            description: desc,
            startTime: `${dateISOday}T17:00:00.000Z`,
            endTime: `${dateISOday}T23:59:00.000Z`,
            attendees: [{ email: emailForInvite }],
            extendedProperties: {
              private: {
                actId: String(updated.actId || ""),
                dateISO: dateISOday,
                enquiryId: updated.enquiryId || "",
              },
            },
          });

          console.log("📆 Calendar invite created", {
            eventId: event?.data?.id || event?.id || "(unknown)",
            attendee: emailForInvite,
          });

          await AvailabilityModel.updateOne(
            { _id: updated._id },
            {
              $set: {
                calendarEventId: event?.data?.id || event?.id || null,
                ...(updated.calendarInviteEmail ? {} : { calendarInviteEmail: emailForInvite }),
                calendarInviteSentAt: new Date(),
                calendarStatus: "needsAction",
              },
            }
          );
        } catch (calErr) {
          console.warn("[V2] Calendar invite failed:", calErr?.message || calErr);
        }
      } else {
        console.warn("⚠️ Skipped calendar invite — missing musician email or date.", {
          emailForInvite,
          dateISO: updated?.dateISO,
        });
      }

      // Confirmation SMS (no WA to avoid duplication)
      try {
        await sendSMSMessage(
          from,
          "Super - thank you for letting us know! We'll update your availability on our system!"
        );
      } catch (ackErr) {
        console.warn("[V2] YES confirmation SMS failed:", ackErr?.message || ackErr);
      }

      // Release queue & finish
      try { await releaseLockAndProcessNext(from); } catch (err) {
        console.warn("[V2] lock release failed:", err?.message || err);
      }
      return res.status(200).send("<Response/>");
    }

    // ---------------- NO / UNAVAILABLE ----------------
    if (reply === "no" || reply === "unavailable") {
      // Clear the badge
      try {
        await Act.updateOne(
          { _id: updated.actId },
          {
            $set: { "availabilityBadge.active": false },
            $unset: {
              "availabilityBadge.vocalistName": "",
              "availabilityBadge.inPromo": "",
              "availabilityBadge.isDeputy": "",
              "availabilityBadge.photoUrl": "",
              "availabilityBadge.musicianId": "",
              "availabilityBadge.dateISO": "",
              "availabilityBadge.address": "",
              "availabilityBadge.setAt": "",
              "availabilityBadge.deputies": "",
            },
          }
        );
        console.log("🏷️ Cleared availability badge due to reply:", reply);
      } catch (e) {
        console.warn("⚠️ Failed to clear availability badge:", e?.message || e);
      }

      // Acknowledge
      try {
        await sendSMSMessage(
          from,
          "Thanks for letting us know! We'll update your availability on our system!"
        );
      } catch (ackErr) {
        console.warn("[V2] NO acknowledgement SMS failed:", ackErr?.message || ackErr);
      }

      // Top up deputies to 3 (re-ping stale pendings, skip NOs, send fresh pings)
      if (act && typeof handleLeadNegativeReply === "function") {
        try {
          console.log("🚨 Lead replied negative, checking deputies…", {
            actId: String(updated.actId || ""),
            lineupId: updated.lineupId?.toString?.(),
            leadPhone: updated.phone,
            duties: updated.duties,
          });
          await handleLeadNegativeReply({ act, updated, fromRaw });
        } catch (e) {
          console.warn("⚠️ handleLeadNegativeReply failed:", e?.message || e);
        }
      } else {
        console.warn("ℹ️ handleLeadNegativeReply not available — skipping deputy top-up.");
      }

      // Release queue & finish
      try { await releaseLockAndProcessNext(from); } catch (err) {
        console.warn("[V2] lock release failed:", err?.message || err);
      }
      return res.status(200).send("<Response/>");
    }

    // Shouldn’t reach here, but be safe
    try { await releaseLockAndProcessNext(from); } catch {}
    return res.status(200).send("<Response/>");
  } catch (e) {
    console.warn("[V2] twilioInboundV2 error:", e?.message || e);
    return res.status(200).send("<Response/>");
  }
}

export async function twilioStatusV2(req, res) {
  try {
    const sidRaw = req.body?.MessageSid || req.body?.SmsSid || req.body?.MessageSid;
    const statusRaw = req.body?.MessageStatus || req.body?.SmsStatus || "";
    const channel = (req.body?.ChannelPrefix || "").toLowerCase(); // "whatsapp" for WA callbacks
    const status = String(statusRaw || "").toLowerCase();
    const sid = String(sidRaw || "").trim();

    console.log("[V2] status:", { sid, status, channel });

    // Only fallback for WhatsApp delivery failures
    const isWA =
      channel === "whatsapp" || (req.body?.From || "").toString().startsWith("whatsapp:");
    const needsFallback = isWA && (status === "undelivered" || status === "failed");

    if (!needsFallback || !sid) {
      return res.status(200).send("<Response/>");
    }

    // 1) Try in-memory cache
    let to = WA_FALLBACK_CACHE.get(sid)?.to || "";
    let smsBody = WA_FALLBACK_CACHE.get(sid)?.smsBody || "";

    // 2) Fall back to DB lookup
    if (!to || !smsBody) {
      const row = await AvailabilityModel.findOne({
        $or: [{ messageSidOut: sid }, { "outbound.sid": sid }],
        v2: true,
      }).lean();

      if (row) {
        to = toE164(row.phone || "");
        smsBody = row?.outbound?.smsBody || "";
      }
    }

    if (!to || !smsBody) {
      console.warn("[V2] WA fallback: no 'to' or 'smsBody' located for", sid);
      return res.status(200).send("<Response/>");
    }

    // Idempotency: mark once
    const mark = await AvailabilityModel.findOneAndUpdate(
      {
        $or: [{ messageSidOut: sid }, { "outbound.sid": sid }, { phone: to }],
        v2: true,
        "outbound.smsFallbackSentAt": { $exists: false },
      },
      {
        $set: {
          "outbound.smsFallbackSentAt": new Date(),
          updatedAt: new Date(),
          status: "sms_sent",
        },
      },
      { new: true }
    );

    if (!mark) return res.status(200).send("<Response/>");

    try {
      await sendSMSMessage(to, smsBody);
      console.log("[V2] WA fallback → SMS sent", { to });
    } catch (smsErr) {
      console.warn("[V2] WA fallback SMS failed:", smsErr?.message || smsErr);
      await AvailabilityModel.updateOne(
        { _id: mark._id },
        { $set: { status: "sms_fallback_failed", updatedAt: new Date() } }
      );
    }
  } catch (e) {
    console.warn("[V2] twilioStatusV2 error:", e?.message || e);
  }
  res.status(200).send("<Response/>");
}