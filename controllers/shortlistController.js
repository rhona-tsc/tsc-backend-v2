import { sendWhatsAppMessage, sendSMSMessage, WA_FALLBACK_CACHE } from "../utils/twilioClient.js";import Act from '../models/actModel.js';
import User from '../models/userModel.js';
import Availability from "../models/availabilityModel.js";
import { createCalendarInvite } from './googleController.js';
import Musician from '../models/musicianModel.js';
import EnquiryMessage from '../models/EnquiryMessage.js';
import twilio from "twilio";
import Shortlist from "../models/shortlistModel.js";
import { extractOutcode, countyFromOutcode, computeMemberMessageFee } from "../controllers/helpersForCorrectFee.js";
import DistanceCache from "../models/distanceCacheModel.js";


const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);


import { toE164 } from "../utils/twilioClient.js";


// Helper: format 26th Jun 2026
function formatShortDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  const day = date.getDate();
  const suffix = [1, 21, 31].includes(day)
    ? "st"
    : [2, 22].includes(day)
    ? "nd"
    : [3, 23].includes(day)
    ? "rd"
    : "th";
  const month = date.toLocaleString("en-GB", { month: "short" });
  const year = date.getFullYear();
  return `${day}${suffix} ${month} ${year}`;
}

// Helper: extract "Berkshire RG45 3RG"
function formatShortAddress(full) {
  if (!full) return "";
  const parts = full.split(",").map((p) => p.trim());
  const lastTwo = parts.slice(-2).join(" ");
  return lastTwo;
}




// 2) Allow overrides (feeOverride/travelOverride/dutiesOverride/actNameOverride)
export async function buildAvailabilitySMS({
  firstName,
  formattedDate,
  formattedAddress,
  act,
  member,
  feeOverride,        // preferred if provided
  travelOverride,
  dutiesOverride,
  actNameOverride,
  countyName,         // e.g. "Berkshire"
}) {
  console.log(`🐠 (controllers/shortlistController.js) buildAvailabilitySMS called at`, new Date().toISOString(), {
  firstName,
  formattedDate,
  formattedAddress,
  actName: act?.tscName,
  memberName: `${member?.firstName || ""} ${member?.lastName || ""}`.trim(),
});
  const shortDate = formatShortDate(formattedDate);
  const shortAddress = formatShortAddress(formattedAddress);

  const base = Number(member?.fee || 0);
  const essentialExtras = (member?.additionalRoles || [])
    .filter(r => r.isEssential)
    .reduce((sum, r) => sum + Number(r.fee || r.additionalFee || 0), 0);

  // 🧾 Travel calculation (direct, matches your working block)
  let travel = 0;
  if (travelOverride != null) {
    travel = Number(travelOverride) || 0;
  } else if (act?.useCountyTravelFee && act?.countyFees) {
    const county = countyName || "";
    travel = Number(act.countyFees[county]) || 0;

    // fallback: search address text for county name
    if (!travel) {
      const match = Object.entries(act.countyFees).find(([k]) =>
        new RegExp(`(^|\\b)${k}(\\b|$)`, "i").test(formattedAddress)
      );
      if (match) travel = Number(match[1]) || 0;
    }

    console.log("🏞️ County-based travel:", { countyName: county, travel });
  } else if (act?.costPerMile) {
    console.log("🛣️ costPerMile travel calculation not implemented here");
  } else if (act?.useMURates) {
    console.log("🎼 MU rate fallback active");
  }

  // 🧮 Totals
  const computedTotal = base + essentialExtras + travel;
  const total = (feeOverride != null && String(feeOverride).trim() !== "")
    ? Number(String(feeOverride).replace(/[^0-9.]/g, ""))
    : computedTotal;

  const duties = dutiesOverride || member?.instrument || "performance";
  const actName = actNameOverride || act?.tscName || act?.name || "the act";

  console.log("💰 Fee breakdown:", {
    musician: `${member?.firstName || ""} ${member?.lastName || ""}`.trim() || "(unknown)",
    act: actName,
    date: shortDate,
    location: shortAddress,
    base,
    essentialExtras,
    travel,
    total,
  });

  return (
    `Hi ${firstName || "there"}, you've received an enquiry for a gig on ` +
    `${shortDate} in ${shortAddress} ` +
    `at a rate of £${total} for ${duties} duties ` +
    `with ${actName}. Please indicate your availability 💫 ` +
    `Reply YES / NO.`
  );
}

function findVocalistPhone(actData, lineupId) {
  console.log(`🐠 (controllers/shortlistController.js) findVocalistPhone called at`, new Date().toISOString(), {
  lineupId,
  totalLineups: actData?.lineups?.length || 0,
});
  if (!actData?.lineups?.length) return null;

  // Prefer specified lineupId
  const lineup = lineupId
    ? actData.lineups.find(l => String(l._id || l.lineupId) === String(lineupId))
    : actData.lineups[0];

  if (!lineup?.bandMembers?.length) return null;

  // Find first member with instrument containing "vocal"
  const vocalist = lineup.bandMembers.find(m =>
    String(m.instrument || "").toLowerCase().includes("vocal")
  );

  if (!vocalist) return null;

  // Safely pick phone fields
  let phone = vocalist.phoneNormalized || vocalist.phoneNumber || "";
  if (!phone && Array.isArray(vocalist.deputies) && vocalist.deputies.length) {
    phone = vocalist.deputies[0].phoneNormalized || vocalist.deputies[0].phoneNumber || "";
  }

  // Normalise to E.164 if needed
  phone = toE164(phone);

  if (!phone) {
    console.warn("⚠️ No valid phone found for vocalist:", {
      vocalist: `${vocalist.firstName} ${vocalist.lastName}`,
      lineup: lineup.actSize,
      act: actData.tscName || actData.name,
    });
    return null;
  }

  console.log("🎤 Lead vocalist found:", {
    name: `${vocalist.firstName} ${vocalist.lastName}`,
    instrument: vocalist.instrument,
    phone,
  });

return { vocalist, phone };}

// handle status callback from Twilio
// ✅ Handle Twilio Status Callback (WhatsApp delivery)
  export const twilioStatusHandler = async (req, res) => {
    console.log(`🐠 (controllers/shortlistController.js) twilioStatusHandler called at`, new Date().toISOString(), {
    body: req.body,
  });
    try {
      const { MessageSid: sid, MessageStatus: status, ErrorCode: err, To: to } = req.body;
      console.log("📡 Twilio status callback:", { sid, status, err, to });

      // Only act if WA failed (undelivered or invalid destination)
      const failed = status === "undelivered" && (err === "63024" || err === "63016");
      if (!failed) return res.status(200).send("OK");

      // Try find the availability record
      let availability = await Availability.findOne({ "outbound.sid": sid }).lean();

      // Fallback: match by phone if SID wasn’t yet written
      if (!availability && to) {
        const normalized = String(to).replace(/^whatsapp:/i, "");
        availability = await Availability.findOne({ phone: normalized }).sort({ createdAt: -1 }).lean();
      }

      if (!availability) {
        console.warn("⚠️ No matching availability found for sid or phone:", sid, to);
        return res.status(200).send("OK");
      }

      // Rebuild SMS body
      const act = await Act.findById(availability.actId).lean();
      console.log("🧭 County travel debug:", {
    county: availability.county || "none",
    useCountyTravelFee: act.useCountyTravelFee,
    countyFees: act.countyFees,
    costPerMile: act.costPerMile,
    useMURates: act.useMURates,
  });

  let travel = 0;

  if (act.useCountyTravelFee && act.countyFees) {
    const countyName = availability.county || ""; // 🌍 stored when derived
    travel = Number(act.countyFees[countyName]) || 0;
    console.log("🏞️ County-based travel:", { countyName, travel });
  } else if (act.costPerMile) {
    console.log("🛣️ costPerMile travel calculation not implemented here");
  } else if (act.useMURates) {
    console.log("🎼 MU rate fallback active");
  }
  // countyFees or costPerMile or MU rates
  if (act.useCountyTravelFee && act.countyFees) {
    const countyMatch = Object.entries(act.countyFees).find(([county]) =>
      availability.formattedAddress?.includes(county)
    );
    if (countyMatch) travel = Number(countyMatch[1]) || 0;
  } else if (act.costPerMile && member.postcode) {
    // (you can later reuse your DistanceCache function for this)
    travel = 0; // stub until DistanceCache integrated
  }

  // 🔧 Build SMS with correct data
  const smsBody = await buildAvailabilitySMS({
    firstName: member.firstName || availability.contactName || availability.firstName,
    formattedDate: availability.dateISO,
    formattedAddress: availability.formattedAddress,
    act,
    member,
    travelOverride: travel,                        // ✅ use the travel you computed
    dutiesOverride: member.instrument,
    actNameOverride: act?.tscName,
    countyName: availability.county,               // may be 'Berkshire'
  });

      // Send fallback SMS
      await sendSMSMessage(to, smsBody);
      console.log(`📩 SMS fallback sent to ${to}`, { sid });
    } catch (err) {
      console.error("❌ Error in Twilio status handler:", err.message);
    }

    res.status(200).send("OK");
  };

// ✅ main function
export const shortlistActAndTriggerAvailability = async (req, res) => {
  console.log(`🐠 (controllers/shortlistController.js) shortlistActAndTriggerAvailability called at`, new Date().toISOString(), {
  body: req.body,
});
  console.log("🎯 [START] shortlistActAndTriggerAvailability");
  try {
    const { userId, actId, selectedDate, selectedAddress, lineupId } = req.body;
    console.log("📦 Incoming body:", { userId, actId, selectedDate, selectedAddress, lineupId });

    if (!userId || !actId) {
      return res.status(400).json({ success: false, message: "Missing userId or actId" });
    }

    const outcode = extractOutcode(selectedAddress);
    const resolvedCounty = countyFromOutcode(outcode);
    console.log("🌍 Derived county:", resolvedCounty || "❌ none");

    // 🗂️ Find or create shortlist
    let shortlist = await Shortlist.findOne({ userId });
    if (!shortlist) shortlist = await Shortlist.create({ userId, acts: [] });
    if (!Array.isArray(shortlist.acts)) shortlist.acts = [];

    const existingEntry = shortlist.acts.find((entry) => {
      const sameAct = String(entry.actId) === String(actId);
      const sameDate = entry.dateISO === selectedDate;
      const sameAddr =
        (entry.formattedAddress || "").trim().toLowerCase() ===
        (selectedAddress || "").trim().toLowerCase();
      return sameAct && sameDate && sameAddr;
    });

    const alreadyShortlisted = !!existingEntry;

    if (alreadyShortlisted) {
      shortlist.acts = shortlist.acts.filter((entry) => {
        const sameAct = String(entry.actId) === String(actId);
        const sameDate = entry.dateISO === selectedDate;
        const sameAddr =
          (entry.formattedAddress || "").trim().toLowerCase() ===
          (selectedAddress || "").trim().toLowerCase();
        return !(sameAct && sameDate && sameAddr);
      });
      console.log("❌ Removed specific act/date/address triple");
    } else {
      shortlist.acts.push({ actId, dateISO: selectedDate, formattedAddress: selectedAddress });
      console.log("✅ Added new act/date/address triple");
    }

    await shortlist.save();

    // ✅ Only send WhatsApp if newly added
    if (!alreadyShortlisted && selectedDate && selectedAddress) {
      const actData = await Act.findById(actId).lean();
      if (!actData) throw new Error("Act not found");

      const lineup = lineupId
        ? actData.lineups?.find((l) => String(l._id) === String(lineupId))
        : actData.lineups?.[0];
      if (!lineup) throw new Error("No lineup found");

      const { vocalist, phone } = findVocalistPhone(actData, lineupId) || {};
      if (!phone || !vocalist) throw new Error("No valid phone for vocalist");

      console.log("✅ Vocalist identified:", {
        name: `${vocalist.firstName} ${vocalist.lastName}`,
        phone,
        act: actData.tscName,
        lineup: lineup.actSize,
      });

      // 🛡️ Guard: prevent duplicate WA sends
      const existingAvailability = await Availability.findOne({
        actId,
        lineupId: lineup._id,
        musicianId: vocalist._id,
        dateISO: selectedDate,
      }).sort({ createdAt: -1 });

      if (existingAvailability && !["no", "unavailable"].includes(existingAvailability.reply)) {
        const status = existingAvailability.status || "sent";
        console.log(
          `🛑 Skipping duplicate WA send — existing record found (status=${status}, reply=${existingAvailability.reply})`
        );
        return res.json({
          success: true,
          message: "Already sent availability request",
          shortlisted: true,
        });
      }

      // 🧾 Compute fee + build message variables
      const shortAddress =
        selectedAddress?.split(",")?.slice(-2)?.join(" ")?.trim() || selectedAddress || "";
      const fee = await computeMemberMessageFee({
        act: actData,
        lineup,
        member: vocalist,
        address: selectedAddress,
        dateISO: selectedDate,
      });

      const msgVars = {
        1: vocalist.firstName || "",
        2: new Date(selectedDate).toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
        3: shortAddress,
        4: fee.toString(),
        5: vocalist.instrument || "",
        6: actData.tscName || "",
      };

      const smsBody = await buildAvailabilitySMS({
        firstName: msgVars[1],
        formattedDate: msgVars[2],
        formattedAddress: msgVars[3],
        act: actData,
        member: vocalist,
        feeOverride: msgVars[4],
        dutiesOverride: msgVars[5],
        actNameOverride: msgVars[6],
        countyName: resolvedCounty,
      });

      // 🧾 Create availability record before WA send
      const availability = await Availability.create({
        actId,
        lineupId: lineup._id,
        musicianId: vocalist._id,
        phone,
        dateISO: selectedDate,
        formattedAddress: selectedAddress,
        county: resolvedCounty,
        formattedDate: new Date(selectedDate).toLocaleDateString("en-GB"),
        duties: vocalist.instrument,
        reply: null,
        status: "queued",
        outbound: { sid: null, smsBody },
      });

      try {
   // ✅ Send WhatsApp message
const safeTsc = actData.tscName
  ?.toLowerCase()
  ?.replace(/\s+/g, "_")
  ?.replace(/[^\w\-]/g, ""); // remove special chars
const payload = `YES_${safeTsc}`;


const waMsg = await client.messages.create({
  from: `whatsapp:${process.env.TWILIO_WA_SENDER}`,
  to: `whatsapp:${phone}`,
  contentSid: process.env.TWILIO_ENQUIRY_SID,
  contentVariables: JSON.stringify(msgVars),
  persistentAction: [`${payload}`], // 👈 optional: for Twilio buttons or interactive messages
});

        console.log(`✅ WhatsApp enquiry sent to ${vocalist.firstName} (${phone}), sid=${waMsg.sid}`);

        await Availability.updateOne(
          { _id: availability._id },
          { $set: { "outbound.sid": waMsg.sid, status: "sent" } }
        );
      } catch (err) {
        // --- WhatsApp undeliverable fallback ---
        if (err.code === 63024 || err.code === 63016) {
          console.warn(`⚠️ WhatsApp undeliverable (${err.code}) for ${phone}. Sending SMS fallback...`);
          await sendSMSMessage(phone, smsBody);
          console.log(`📩 SMS fallback sent to ${phone}`);
          await Availability.updateOne(
            { _id: availability._id },
            { $set: { status: "sms_sent" } }
          );
        } else {
          console.error("❌ WhatsApp send error:", err.message);
          throw err;
        }
      }
    }

    res.json({
      success: true,
      message: alreadyShortlisted
        ? "Removed from shortlist"
        : "Added and message sent",
      shortlisted: !alreadyShortlisted,
    });
  } catch (err) {
    console.error("❌ shortlistActAndTriggerAvailability error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Get all shortlisted acts for a user.
 */
export const getUserShortlist = async (req, res) => {
  
  console.log(`🐠 (controllers/shortlistController.js) getUserShortlist called at`, new Date().toISOString(), {
  userId: req.params.userId,
});
  try {
    const { userId } = req.params;
    const shortlist = await Availability.findOne({ userId }).populate("acts");
    if (!shortlist) {
      return res.json({ success: true, acts: [] });
    }
    res.json({ success: true, acts: shortlist.acts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const notifyMusician = async (req, res) => {
  console.log(`🐠 (controllers/shortlistController.js) notifyMusician called at`, new Date().toISOString(), {
  phone: req.body.phone,
});
    const { phone, message } = req.body;
  
    if (!phone || !message) {
      console.error("❌ Missing fields in request body:", req.body);
      return res.status(400).json({ success: false, message: "Phone or message missing" });
    }
  
    console.log("📞 Would send message to:", phone);
    console.log("📨 Message:", message);
  
    try {
      // Convert UK 07... numbers to +447... format for WhatsApp
      const formattedPhone = phone.startsWith('07') ? phone.replace(/^0/, '+44') : phone;
      await sendWhatsAppMessage(formattedPhone, message);
      return res.status(200).json({ success: true, message: "WhatsApp message sent" });
    } catch (error) {
      console.error("❌ Error sending WhatsApp:", error);
      return res.status(500).json({ success: false, message: error.message });
    }
  };

export const shortlistActAndTrack = async (req, res) => {
  console.log(`🐠 (controllers/shortlistController.js) shortlistActAndTrack called at`, new Date().toISOString(), {
  body: req.body,
});
  try {
    const { userId, actId } = req.body;
    if (!userId || !actId) return res.status(400).json({ success: false, message: 'Missing userId or actId' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    console.log("🔍 User found:", user._id, "Shortlisted acts before:", user.shortlistedActs, user);
    if (!user.shortlistedActs.includes(actId)) {
      user.shortlistedActs.push(actId);
      await user.save();
      await Act.findByIdAndUpdate(actId, { $inc: { timesShortlisted: 1 } });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
  
  export const whatsappReplyHandler = async (req, res) => {
    console.log(`🐠 (controllers/shortlistController.js) whatsappReplyHandler called at`, new Date().toISOString(), {
  from: req.body.From,
  body: req.body.Body,
});
    console.log("🌍 Webhook HIT");
    const reply = req.body.Body?.trim().toLowerCase();
    const message = req.body.Body || '';
    const fee = req.body.fee ? `£${req.body.fee}` : (() => {
      const feeMatch = message.match(/£(\d+)/);
      return feeMatch ? `£${feeMatch[1]}` : 'Not specified';
    })();
  
    const normalizePhone = (phone) => {
      if (!phone) return null;
      let cleaned = phone.replace(/\s+/g, '');
      if (cleaned.startsWith('whatsapp:')) cleaned = cleaned.replace('whatsapp:', '');
      if (!cleaned.startsWith('+')) {
        if (cleaned.startsWith('07')) {
          return cleaned.replace(/^0/, '+44');
        } else if (cleaned.startsWith('44')) {
          return '+' + cleaned;
        }
      }
      return cleaned;
    };
  
    const from = normalize(req.body.From || "");
    const candidates = Array.from(new Set([
      from,                                             // +4478…
      (req.body.From || "").replace(/^whatsapp:/i, ''), // raw +4478…
      from.replace(/^\+44/, '0'),                       // 07…
      from.replace(/^\+44/, '44'),                      // 4478…
    ]));
    console.log("🔎 Musician phone candidates:", candidates);
  
    // Try to find the musician by any of the common phone formats or in basicInfo.phone
    const musician = await Musician.findOne({
      $or: [
        { phone: { $in: candidates } },
        { 'basicInfo.phone': { $in: candidates } },
      ]
    });
    if (!musician) {
      console.warn("⚠️ No musician matched for inbound", { from, candidates });
      return res.status(200).send('<Response/>');
    }
  
    const parsedDate = req.body.date
      ? new Date(req.body.date)
      : (() => {
          const fallbackDateMatch = message.match(/\b(?:on|for)?\s*(\d{1,2})(st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})\b/i);
          if (fallbackDateMatch) {
            const [, day, , month, year] = fallbackDateMatch;
            return new Date(`${day} ${month} ${year}`);
          }
          return new Date();
        })();
    const incomingDate = req.body.date || null;
    console.log("📅 Incoming date from WhatsApp webhook:", incomingDate, "-> Parsed:", parsedDate);

    // Try to identify act for this reply:
    // 1) direct actId from webhook body if your template sends it
    // 2) or parse "Ref: <actId>" if included in the body text
    const actIdFromBody =
      req.body.actId ||
      (message.match(/Ref:\s*([a-f0-9]{24})/i)?.[1] ?? null);

    const act = actIdFromBody ? await Act.findById(actIdFromBody).lean() : null;

    // Try to correlate this reply to the latest outbound enquiry for this musician (by phone)
    let enquiry = await EnquiryMessage.findOne({
      musicianId: musician._id,
      ...(act?._id ? { actId: act._id } : {}),
      ...(incomingDate ? { 'meta.MetaISODate': incomingDate } : {}),
    }).sort({ createdAt: -1 });

    if (enquiry) {
      await EnquiryMessage.updateOne(
        { _id: enquiry._id },
        { $set: { status: reply, reply, repliedAt: new Date() } }
      );
    } else {
      // Fallback: tie by phone only if nothing matched
      enquiry = await EnquiryMessage.findOneAndUpdate(
        { phone: { $in: candidates } },
        { $set: { status: reply, reply, repliedAt: new Date() } },
        { sort: { createdAt: -1 }, new: true }
      );
    }

    try {
      const availability = await Availability.create({
        musicianId: musician._id,
        actId: act?._id,
        date: parsedDate,
        address: req.body.address || 'TBC',
        reply,
        enquiryMessageId: enquiry?._id || null,
      });
      console.log("✅ Availability saved:", availability._id.toString(), reply);
  
      if (!musician.availability) {
        musician.availability = [];
      }
      musician.availability.push(availability._id);
      await musician.save();
      console.log(`✅ Saved availability for ${musician.firstName} ${musician.lastName}`);
  
      // Create templateParams for Twilio message
      const templateParams = {
        '1': musician.firstName, // Musician's name
        '2': parsedDate.toDateString(), // Date
        '3': req.body.address || 'Not provided', // Location
        '4': fee, // Fee
        '5': musician.instrument || 'Not specified', // Instrument
        '6': act?.tscName || ''
      };
  
      // Send WhatsApp message with template
      const formattedPhone = from.startsWith('07') ? from.replace(/^0/, '+44') : from;
      await sendWhatsAppMessage(
        formattedPhone,  // Send message to musician's phone
        `Hi {{1}}! Are you available on {{2}} for a gig in {{3}} at a rate of £{{4}} for {{5}} duties with {{6}}?`,  // Template message
        templateParams   // Template parameters
      );
  
      if (reply === 'yes') {
        const start = new Date(parsedDate);
        start.setHours(17, 0, 0, 0); // Set start time to 5pm local time
  
        const end = new Date(start);
        end.setHours(23, 59, 0, 0); // Set end time to midnight local time
  
        // Append this enquiry to the existing calendar event's description if one already exists
        const existingEvent = null; // Placeholder: implement calendar event lookup logic if needed
  
        const descriptionLine = `Enquiry for ${parsedDate.toDateString()} at ${req.body.address} for ${fee}`;
        const description = existingEvent?.description
          ? `${existingEvent.description}\n${descriptionLine}`
          : descriptionLine;
  
        await createCalendarInvite({
          enquiryId,
          email: musician.email,
          summary: `TSC: Enquiry`,
          description,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
        });
  
        console.log(`📆 Calendar invite sent to ${musician.email}`);
      }
  
      // Determine if this musician is a lead in any lineup of this act
      if (act) {
        const allMembers = (act.lineups || []).flatMap(l =>
          Array.isArray(l.bandMembers) ? l.bandMembers : []
        );
        const vocalRoles = ["Lead Male Vocal","Lead Female Vocal","Lead Vocal","vocalist-guitarist"];
        const isLead = allMembers.some(m =>
          (m.musicianId?.toString?.() === musician._id.toString()) &&
          vocalRoles.includes(m.instrument)
        );
  
        if (reply === 'yes') {
          // Broadcast to frontend via SSE -> triggers toast + badge
          const payload = {
            actId: act._id.toString(),
            actName: act.tscName,
            musicianName: musician.firstName,
            dateISO: parsedDate.toISOString(),
          };
          if (isLead) availabilityNotify.leadYes(payload);
          else availabilityNotify.deputyYes(payload);
        }
  
        // On NO/UNAVAILABLE escalate to first deputy not equal to current musician
        if (reply === 'no' || reply === 'unavailable') {
          const vocalists = allMembers.filter(m => vocalRoles.includes(m.instrument));
          const deputies = [];
          for (const v of vocalists) {
            const deps = Array.isArray(v.deputies) ? v.deputies : [];
            for (const d of deps) deputies.push(d);
          }
          const nextDep = deputies.find(d => {
            const id = (d.musicianId?.toString?.() || d?._id?.toString?.() || "").toString();
            return id && id !== musician._id.toString();
          });
  
          if (nextDep && (nextDep.phoneNumber || nextDep.phone)) {
            const phone = (nextDep.phoneNumber || nextDep.phone).replace(/^0/, "+44");
            await sendWhatsAppMessage(phone, {
              FirstName: nextDep.firstName || "there",
              FormattedDate: parsedDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
              FormattedAddress: (req.body.address || "TBC"),
              Fee: (req.body.fee != null && String(req.body.fee).trim() !== "" ? String(req.body.fee).replace(/^£/, ""): 'TBC'),
              Duties: member.instrument,
              ActName: act.tscName,
            });
          }
        }
      }
    } catch (err) {
      console.error("❌ Error processing WhatsApp reply:", err.message);
    }
  
    res.send('<Response></Response>');
  };
/// old code end

