import { sendWhatsAppMessage } from '../utils/twilioClient.js';
import Act from '../models/actModel.js';
import User from '../models/userModel.js';
import { sendSMSMessage } from "../utils/twilioClient.js";
import Availability from "../models/availabilityModel.js";
import { sendAvailabilityMessage } from "../utils/twilioHelpers.js";
import { createCalendarInvite } from './googleController.js';
import Musician from '../models/musicianModel.js';
import EnquiryMessage from '../models/EnquiryMessage.js';
import twilio from "twilio";
import Shortlist from "../models/shortlistModel.js";
import { extractOutcode, countyFromOutcode } from "../controllers/helpersForCorrectFee.js";
import { computePerMemberFee } from "./bookingController.js";




const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);


import { toE164 } from "../utils/twilioClient.js";




function findVocalistPhone(actData, lineupId) {
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

// ✅ main function
export const shortlistActAndTriggerAvailability = async (req, res) => {
  console.log("🎯 [START] shortlistActAndTriggerAvailability");
  try {
    const { userId, actId, selectedDate, selectedAddress, lineupId } = req.body;
    console.log("📦 Incoming body:", { userId, actId, selectedDate, selectedAddress, lineupId });

    try {
      const mongooseConn = (await import("mongoose")).default.connection;
      console.log("🗃️ DB:", { name: mongooseConn?.name, host: mongooseConn?.host });
    } catch {}

    if (!userId || !actId) {
      console.warn("⚠️ Missing userId or actId");
      return res.status(400).json({ success: false, message: "Missing userId or actId" });
    }

    const outcode = extractOutcode(selectedAddress);
    const resolvedCounty = countyFromOutcode(outcode);
    console.log("🌍 Derived county:", resolvedCounty || "❌ none");

    let shortlist = await Shortlist.findOne({ userId });
    if (!shortlist) {
      console.log("🆕 Creating new shortlist for userId:", userId);
      shortlist = await Shortlist.create({ userId, acts: [] });
    }
    if (!Array.isArray(shortlist.acts)) shortlist.acts = [];

    const existingEntry = shortlist.acts.find((entry) => {
      const sameAct = String(entry.actId) === String(actId);
      const sameDate = entry.dateISO === selectedDate;
      const addrA = (entry.formattedAddress || "").trim().toLowerCase();
      const addrB = (selectedAddress || "").trim().toLowerCase();
      return sameAct && sameDate && addrA === addrB;
    });

    const alreadyShortlisted = !!existingEntry;
    console.log("🧮 alreadyShortlisted:", alreadyShortlisted);

    // ✅ Add or remove act from shortlist
    if (alreadyShortlisted) {
      shortlist.acts = shortlist.acts.filter((entry) => {
        const sameAct = String(entry.actId) === String(actId);
        const sameDate = entry.dateISO === selectedDate;
        const sameAddress =
          (entry.formattedAddress || "").trim().toLowerCase() ===
          (selectedAddress || "").trim().toLowerCase();
        return !(sameAct && sameDate && sameAddress);
      });
      console.log("❌ Removed specific act/date/address triple");
    } else {
      shortlist.acts.push({ actId, dateISO: selectedDate, formattedAddress: selectedAddress });
      console.log("✅ Added new act/date/address triple");
    }

    await shortlist.save();
    console.log("💾 shortlist saved:", shortlist.acts);

    // ✅ Only send WA if newly added
    if (!alreadyShortlisted && selectedDate && selectedAddress) {
      console.log("💬 Triggering availability WhatsApp message…");

      const actData = await Act.findById(actId).lean();
      if (!actData) throw new Error("Act not found");

      const lineup =
        lineupId
          ? actData.lineups?.find((l) => String(l._id) === String(lineupId))
          : actData.lineups?.[0];
      if (!lineup) throw new Error("No lineup found");

      const { vocalist, phone } = findVocalistPhone(actData, lineupId) || {};
      if (!phone || !vocalist) throw new Error("No valid phone for vocalist");

      console.log("✅ Vocalist identified:", {
        name: `${vocalist.firstName} ${vocalist.lastName}`,
        phone,
        act: actData.name,
        lineup: lineup.actSize,
      });

      // 🧠 Debug: check if whatsappOptIn is coming through
      console.log("🎤 Vocalist full object snapshot:", {
        name: `${vocalist.firstName} ${vocalist.lastName}`,
        phone: vocalist.phoneNormalized || vocalist.phoneNumber,
        whatsappOptIn: vocalist.whatsappOptIn,
        rawKeys: Object.keys(vocalist),
      });

      // 🛡️ Respect WhatsApp opt-in flag
      if (!Boolean(vocalist.whatsappOptIn)) {
        console.log(`🚫 Skipping WhatsApp for ${vocalist.firstName} (opt-in=${vocalist.whatsappOptIn})`);
        console.log("🧩 Opt-in Debug Context:", {
          actId,
          lineupId,
          phone: vocalist.phoneNormalized || vocalist.phoneNumber,
          availableKeys: Object.keys(vocalist),
        });

        // 📨 Send one-time opt-in invitation via SMS
        try {
          await client.messages.create({
            from: process.env.TWILIO_SMS_SENDER,
            to: phone,
            body: `Hi ${vocalist.firstName}, it's The Supreme Collective 👋 
We send gig availability requests via WhatsApp for quick replies. 
Please message us on WhatsApp at ${process.env.TWILIO_WA_SENDER.replace(
              "whatsapp:",
              ""
            )} or click: https://wa.me/${process.env.TWILIO_WA_SENDER.replace(
              "whatsapp:+",
              ""
            )} to opt in.`,
          });
          console.log(`📩 Opt-in invite SMS sent to ${phone}`);
        } catch (err) {
          console.error("❌ Failed to send opt-in SMS:", err.message);
        }

        return res.json({
          success: true,
          message: `${vocalist.firstName} not opted in — sent opt-in invite.`,
        });
      }

      // 🧾 Create availability record
      const availabilityDoc = {
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
      };
      await Availability.create(availabilityDoc);

      const shortAddress =
        selectedAddress?.split(",")?.slice(-2)?.join(" ")?.trim() ||
        selectedAddress ||
        "";

      const fee = await computePerMemberFee({
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
        6: actData.name || "",
      };

      try {
        await client.messages.create({
          from: `whatsapp:${process.env.TWILIO_WA_SENDER}`,
          to: `whatsapp:${phone}`,
          contentSid: process.env.TWILIO_ENQUIRY_SID,
          contentVariables: JSON.stringify(msgVars),
        });
        console.log(`✅ WhatsApp enquiry sent to ${vocalist.firstName} (${phone})`);
      } catch (err) {
        if (err.code === 63024 || err.code === 63016) {
          console.warn("⚠️ WhatsApp delivery failed — sending SMS fallback...");
          await client.messages.create({
            from: process.env.TWILIO_SMS_SENDER,
            to: phone,
            body: `Hi ${msgVars[1]}, just checking availability for ${msgVars[6]} on ${msgVars[2]} in ${msgVars[3]}. Can you confirm if you’re free?`,
          });
          console.log(`📩 SMS fallback sent to ${phone}`);
        } else {
          console.error("❌ WhatsApp send error:", err.message);
          throw err;
        }
      }
    } else {
      console.log("🚫 Not sending message (already shortlisted or missing date/address)");
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
        '6': act?.name || ''
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
            actName: act.name,
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

