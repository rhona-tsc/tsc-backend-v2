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

  return phone;
}


export const shortlistActAndTriggerAvailability = async (req, res) => {
  console.log("🎯 [START] shortlistActAndTriggerAvailability");
  try {
    const { userId, actId, selectedDate, selectedAddress, selectedCounty, lineupId } = req.body;
    console.log("📦 Incoming body:", { userId, actId, selectedDate, selectedAddress, selectedCounty, lineupId });

    if (!userId || !actId) {
      console.warn("⚠️ Missing userId or actId");
      return res.status(400).json({ success: false, message: "Missing userId or actId" });
    }

    // 1️⃣ Add or toggle in shortlist DB
    console.log("📚 Looking up existing Availability shortlist for userId:", userId);
    let shortlist = await Availability.findOne({ userId });
    if (!shortlist) {
      console.log("🆕 Creating new Availability shortlist for userId:", userId);
      shortlist = await Availability.create({ userId, acts: [] });
    }

    const alreadyShortlisted = shortlist.acts.includes(actId);
    console.log("🧮 alreadyShortlisted:", alreadyShortlisted);

    if (alreadyShortlisted) {
      console.log("❌ Removing from shortlist");
      shortlist.acts = shortlist.acts.filter((a) => String(a) !== String(actId));
    } else {
      console.log("✅ Adding act to shortlist array");
      shortlist.acts.push(actId);
    }

    await shortlist.save();
    console.log("💾 shortlist saved:", shortlist.acts);

    // 2️⃣ Trigger WhatsApp message (only when adding)
    if (!alreadyShortlisted && selectedDate && selectedAddress) {
      console.log("💬 Triggering availability WhatsApp message…");

      // --- Fetch act with lineup and members ---
      const actData = await Act.findById(actId).lean();
      console.log("🎭 Act data loaded:", actData ? "✅ Found" : "❌ Not found");

      if (!actData) throw new Error("Act not found");

      const lineup = lineupId
        ? actData.lineups?.find((l) => String(l._id) === String(lineupId))
        : actData.lineups?.[0];
      console.log("🎼 Selected lineup:", lineup ? lineup.actSize : "❌ None found");

      if (!lineup) throw new Error("No lineup found for act");

      console.log("👥 Band members:", lineup.bandMembers?.length || 0);
      const vocalist = lineup.bandMembers?.find((m) =>
        m.instrument?.toLowerCase().includes("vocal")
      );
      console.log("🎤 Vocalist found:", vocalist ? `${vocalist.firstName} ${vocalist.lastName}` : "❌ None");

      if (!vocalist) throw new Error("No vocalist found in lineup");

      // --- Resolve phone ---
      const phone = findVocalistPhone(actData, lineupId);
      console.log("📞 Phone resolved:", phone || "❌ NULL");
      if (!phone) throw new Error("No valid phone found for vocalist");

      console.log("✅ Vocalist identified:", {
        name: `${vocalist.firstName} ${vocalist.lastName}`,
        phone,
        act: actData.name,
        lineup: lineup.actSize,
      });

      // --- Create an availability record ---
      console.log("🧾 Creating new Availability entry…");
      const availabilityDoc = {
        actId,
        lineupId: lineup._id,
        musicianId: vocalist._id,
        phone,
        dateISO: selectedDate,
        formattedAddress: selectedAddress,
        formattedDate: new Date(selectedDate).toLocaleDateString("en-GB"),
        duties: vocalist.instrument,
        reply: null,
        status: "pending",
      };
      console.log("📋 Availability payload:", availabilityDoc);

      await Availability.create(availabilityDoc);
      console.log("✅ Availability document created successfully");

      // --- Send WhatsApp via Twilio template ---
      console.log("📨 Sending WhatsApp template message via Twilio…");
      await client.messages.create({
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to: `whatsapp:${phone}`,
        contentSid: process.env.TWILIO_ENQUIRY_SID,
        contentVariables: JSON.stringify({
          1: vocalist.firstName,
          2: new Date(selectedDate).toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
          3: selectedAddress,
          4: vocalist.fee || 0,
          5: vocalist.instrument,
          6: actData.name,
        }),
      });

      console.log(`✅ WhatsApp enquiry sent successfully to ${vocalist.firstName} (${phone})`);
    } else {
      console.log("🚫 Not sending message (either already shortlisted or missing date/address)");
    }

    console.log("🏁 [END] shortlistActAndTriggerAvailability");
    res.json({
      success: true,
      message: alreadyShortlisted ? "Removed from shortlist" : "Added and message sent",
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

