import express from "express";
import mongoose from "mongoose";
import Availability from "../models/availabilityModel.js";
import { processAvailabilityReplyFlow } from "../controllers/availabilityController.js";
import musicianAuth from "../middleware/musicianAuth.js";
import Musician from "../models/musicianModel.js";
import MessageConversation from "../models/messageConversationModel.js";
import sendEmail from "../utils/sendEmail.js";
import { fetchTwilioConversation } from "../utils/twilioClient.js";

const router = express.Router();

const normalize = (s = "") => String(s || "").trim().toLowerCase();

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const toDateValue = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
};

const pickRecipientName = (row) =>
  row.selectedVocalistName ||
  row.vocalistName ||
  row.musicianName ||
  row.contactName ||
  "";

const pickRecipientEmail = (row) =>
  row.musicianEmail || row.calendarInviteEmail || "";

const normalizePhone = (value = "") => {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("44") && digits.length >= 12) return digits.slice(-10);
  if (digits.startsWith("0") && digits.length >= 11) return digits.slice(-10);
  return digits.length >= 10 ? digits.slice(-10) : digits;
};

const enrichRowsWithMusicianProfiles = async (rows = []) => {
  if (!rows.length) return rows;

  const musicians = await Musician.find({
    $or: [
      { _id: { $in: rows.map((row) => row.musicianId).filter(Boolean) } },
      { phone: { $exists: true, $ne: "" } },
      { phoneNormalized: { $exists: true, $ne: "" } },
    ],
  })
    .select("_id firstName lastName stageName email phone phoneNormalized")
    .lean();

  const byId = new Map(musicians.map((musician) => [String(musician._id), musician]));
  const byPhone = new Map();
  for (const musician of musicians) {
    for (const value of [musician.phone, musician.phoneNormalized]) {
      const key = normalizePhone(value);
      if (key && !byPhone.has(key)) byPhone.set(key, musician);
    }
  }

  return rows.map((row) => {
    const musician =
      (row.musicianId && byId.get(String(row.musicianId))) ||
      byPhone.get(normalizePhone(row.phone));
    if (!musician) return row;

    return {
      ...row,
      musicianId: row.musicianId || musician._id,
      musicianName: pickRecipientName(row) || musicianDisplayName(musician),
      musicianEmail: row.musicianEmail || musician.email || "",
    };
  });
};

const buildFallbackOutboundBody = (row) => {
  const firstName = String(
    row.recipientName ||
      row.selectedVocalistName ||
      row.vocalistName ||
      row.musicianName ||
      "there"
  )
    .trim()
    .split(/\s+/)[0] || "there";

  const feeStr = row.fee ? `£${row.fee}` : "TBC";
  const roleStr = row.duties || "Performance";
  const actName = row.actName || "the act";
  const location = row.shortAddress || row.formattedAddress || "TBC";
  const dateText = row.formattedDate || row.eventDate || row.dateISO || "TBC";

  return `Hi ${firstName}, you've received an enquiry for a gig on ${dateText} in ${location} at a rate of ${feeStr} for ${roleStr} duties with ${actName}. Please indicate your availability 💫`;
};

const getActorFromReq = (req) => {
  const userRole =
    req.userRole ||
    req.user?.role ||
    req.headers.userrole ||
    req.headers.Userrole ||
    "";

  const userId =
    req.userId ||
    req.user?._id ||
    req.user?.id ||
    req.headers.userid ||
    req.headers.Userid ||
    "";

  const firstName =
    req.user?.firstName ||
    req.headers.firstname ||
    req.headers.Firstname ||
    "";

  return {
    userRole: normalize(userRole),
    userId: String(userId || ""),
    firstName: String(firstName || ""),
  };
};

const buildThreadKey = (row) => {
  const musicianId = row.musicianId ? String(row.musicianId) : "no-musician";
  const phone = String(row.phone || "no-phone").trim();

  return musicianId !== "no-musician"
    ? `person__${musicianId}`
    : `phone__${phone}`;
};

const buildThreadsFromRows = (rows = []) => {
  const map = new Map();

  for (const row of rows) {
    const key = buildThreadKey(row);

    if (!map.has(key)) {
      map.set(key, {
        _id: key,
        enquiryId: row.enquiryId || "",
        requestId: row.requestId || "",
        requestKey: row.requestKey || "",
        reference: row.enquiryId || row.requestId || row.requestKey || "—",
        actId: row.actId || null,
        actName: row.actName || "",
        lineupId: row.lineupId || null,
        musicianId: row.musicianId || null,
        bandMemberId: row.bandMemberId || null,
        recipientName: pickRecipientName(row),
        recipientPhone: row.phone || "",
        recipientEmail: pickRecipientEmail(row),
        musicianEmail: row.musicianEmail || "",
        clientName: row.clientName || "",
        clientEmail: row.clientEmail || "",
        slotIndex: Number(row.slotIndex ?? 0),
        slotLabel: `Slot ${Number(row.slotIndex ?? 0) + 1}`,
        eventDate: row.dateISO || "",
        formattedDate: row.formattedDate || "",
        formattedAddress: row.formattedAddress || "",
        duties: row.duties || "",
        fee: row.fee || "",
        profileUrl: row.profileUrl || "",
        photoUrl: row.photoUrl || "",
        channel: row.outboundChannel || "whatsapp",
        status: row.reply ? "replied" : row.status || "queued",
        outboundSentAt: row.outboundSentAt || row.createdAt || null,
        reply: row.reply || null,
        unreadReplies: 0,
        messageCount: 0,
        latestMessage: null,
        messages: [],
        rows: [],
        updatedAt: row.updatedAt || row.createdAt || new Date(),
      });
    }

    const thread = map.get(key);
    thread.rows.push(row);

    if (!thread.recipientName) thread.recipientName = pickRecipientName(row);
    if (!thread.recipientEmail) thread.recipientEmail = pickRecipientEmail(row);
    if (!thread.musicianEmail) thread.musicianEmail = row.musicianEmail || "";
    if (!thread.profileUrl) thread.profileUrl = row.profileUrl || "";
    if (!thread.photoUrl) thread.photoUrl = row.photoUrl || "";
    if (!thread.formattedAddress) thread.formattedAddress = row.formattedAddress || "";
    if (!thread.formattedDate) thread.formattedDate = row.formattedDate || "";
    if (!thread.eventDate) thread.eventDate = row.dateISO || "";
    if (!thread.duties) thread.duties = row.duties || "";
    if (!thread.fee) thread.fee = row.fee || "";
    if (!thread.clientName) thread.clientName = row.clientName || "";
    if (!thread.clientEmail) thread.clientEmail = row.clientEmail || "";
    if (!thread.outboundSentAt && (row.outboundSentAt || row.createdAt)) {
      thread.outboundSentAt = row.outboundSentAt || row.createdAt;
    }

    if (row.updatedAt && new Date(row.updatedAt) > new Date(thread.updatedAt)) {
      thread.updatedAt = row.updatedAt;
    }

   if (row.messageSidOut || row.outboundMessage) {
  thread.messages.push({
    _id: `out-${row._id}`,
    senderRole: "agent",
    senderName: "System",
    body: row.outboundMessage || buildFallbackOutboundBody(row),
    channel: row.outboundChannel || "whatsapp",
    createdAt: row.outboundSentAt || row.createdAt,
    source: "availability-outbound",
    sid: row.messageSidOut || null,
    rowId: String(row._id),
    requestId: row.requestId || "",
    slotIndex: Number(row.slotIndex ?? 0),
    reply: row.reply || null,
  });
}

  if (row.inbound?.body || row.reply) {
  thread.messages.push({
    _id: `in-${row._id}`,
    senderRole: "musician",
    senderName: row.musicianName || row.contactName || "Musician",
    body: row.inbound?.body || row.inbound?.buttonText || row.reply || "",
    channel: "whatsapp",
    createdAt: row.repliedAt || row.updatedAt || row.createdAt,
    source: "availability-inbound",
    sid: row.inbound?.sid || null,
    rowId: String(row._id),
    requestId: row.requestId || "",
    slotIndex: Number(row.slotIndex ?? 0),
    reply: row.reply || null,
    buttonText: row.inbound?.buttonText || "",
    buttonPayload: row.inbound?.buttonPayload || "",
  });

  if (!row.inbound?.readByAdmin) {
    thread.unreadReplies += 1;
  }
}

    if (Array.isArray(row.websiteReplies)) {
      for (const reply of row.websiteReplies) {
        thread.messages.push({
          _id: `web-${row._id}-${reply._id || reply.createdAt}`,
          senderRole: reply.senderRole,
          senderName: reply.senderName || reply.senderRole || "User",
          body: reply.body,
          channel: "website",
          createdAt: reply.createdAt,
          source: "website-reply",
        });

        if (reply.senderRole === "musician" && !reply.readByAdmin) {
          thread.unreadReplies += 1;
        }
      }
    }
  }

  const threads = Array.from(map.values()).map((thread) => {
    thread.messages.sort((a, b) => toDateValue(a.createdAt) - toDateValue(b.createdAt));

    thread.latestMessage =
      thread.messages[thread.messages.length - 1] || null;

    if (!thread.latestMessage && thread.outboundSentAt) {
      thread.latestMessage = {
        body: buildFallbackOutboundBody(thread),
        createdAt: thread.outboundSentAt,
        channel: thread.channel || "whatsapp",
      };
    }

        thread.messageCount = thread.messages.length;


    return thread;
  });

  threads.sort((a, b) => {
    const aTime = toDateValue(a.latestMessage?.createdAt || a.updatedAt || a.outboundSentAt);
    const bTime = toDateValue(b.latestMessage?.createdAt || b.updatedAt || b.outboundSentAt);
    return bTime - aTime;
  });

  return threads;
};

const musicianDisplayName = (musician = {}) =>
  [musician.firstName, musician.lastName].filter(Boolean).join(" ").trim() ||
  musician.stageName ||
  musician.email ||
  "Musician";

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const notifyMusicianOfPortalMessage = async (musician) => {
  if (!musician?.email) return false;
  const portalUrl = `${String(
    process.env.ADMIN_FRONTEND_URL ||
      process.env.MUSICIAN_PORTAL_URL ||
      "https://admin.thesupremecollective.co.uk",
  ).replace(/\/$/, "")}/messages`;
  const firstName = musician.firstName || "there";
  const result = await sendEmail({
    to: musician.email,
    subject: "You have a new message from The Supreme Collective",
    text: `Hi ${firstName},\n\nYou have a new message in your musician portal.\n\nView and reply: ${portalUrl}\n\nThe Supreme Collective`,
    html: `<p>Hi ${escapeHtml(firstName)},</p><p>You have a new message in your musician portal.</p><p><a href="${escapeHtml(portalUrl)}">View and reply to your message</a></p><p>The Supreme Collective</p>`,
  });
  return Boolean(result?.ok || result?.accepted?.length);
};

const mergeConversationThreads = (
  availabilityThreads = [],
  conversations = [],
  viewerIsAgent = false,
) => {
  const map = new Map(availabilityThreads.map((thread) => [thread._id, thread]));

  for (const conversation of conversations) {
    const threadId = `person__${conversation.musicianId}`;
    const existing = map.get(threadId) || {
      _id: threadId,
      musicianId: conversation.musicianId,
      recipientName: conversation.recipientName || "Musician",
      recipientEmail: conversation.recipientEmail || "",
      recipientPhone: conversation.recipientPhone || "",
      actName: "",
      reference: "Direct message",
      eventDate: "",
      formattedDate: "",
      slotLabel: "",
      channel: "website",
      status: "sent",
      unreadReplies: 0,
      messages: [],
      rows: [],
      updatedAt: conversation.updatedAt || conversation.createdAt,
    };

    if (!existing.recipientName) existing.recipientName = conversation.recipientName;
    if (!existing.recipientEmail) existing.recipientEmail = conversation.recipientEmail;
    if (!existing.recipientPhone) existing.recipientPhone = conversation.recipientPhone;

    for (const message of conversation.messages || []) {
      existing.messages.push({
        _id: `conversation-${message._id}`,
        senderRole: message.senderRole,
        senderName: message.senderName || message.senderRole,
        body: message.body,
        channel: message.channel || "website",
        createdAt: message.createdAt,
        source: "direct-conversation",
      });
      const unreadForViewer = viewerIsAgent
        ? message.senderRole === "musician" && !message.readByAdmin
        : message.senderRole === "agent" && !message.readByMusician;
      if (unreadForViewer) {
        existing.unreadReplies += 1;
      }
    }

    existing.messages.sort(
      (a, b) => toDateValue(a.createdAt) - toDateValue(b.createdAt),
    );
    existing.latestMessage = existing.messages.at(-1) || existing.latestMessage || null;
    existing.messageCount = existing.messages.length;
    existing.status = existing.messages.some((message) => message.senderRole === "musician")
      ? "replied"
      : existing.status || "sent";
    existing.updatedAt = conversation.updatedAt || existing.updatedAt;
    map.set(threadId, existing);
  }

  return Array.from(map.values()).sort(
    (a, b) =>
      toDateValue(b.latestMessage?.createdAt || b.updatedAt) -
      toDateValue(a.latestMessage?.createdAt || a.updatedAt),
  );
};

const addConversationMessage = async ({
  musician,
  senderRole,
  senderName,
  senderId,
  body,
}) => {
  const message = {
    body: String(body).trim(),
    senderRole,
    senderName,
    senderId: isObjectId(senderId) ? senderId : null,
    channel: "website",
    readByAdmin: senderRole === "agent",
    readByMusician: senderRole === "musician",
    createdAt: new Date(),
  };

  return MessageConversation.findOneAndUpdate(
    { musicianId: musician._id },
    {
      $set: {
        recipientName: musicianDisplayName(musician),
        recipientEmail: musician.email || "",
        recipientPhone: musician.phone || musician.phoneNormalized || "",
      },
      $push: { messages: message },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
};

router.get("/recipients", musicianAuth, async (req, res) => {
  try {
    const { userRole } = getActorFromReq(req);
    if (userRole !== "agent" && userRole !== "admin") {
      return res.status(403).json({ success: false, message: "Not authorised" });
    }

    const musicians = await Musician.find({ email: { $exists: true, $ne: "" } })
      .select("_id firstName lastName stageName email phone phoneNormalized profilePhoto")
      .sort({ firstName: 1, lastName: 1 })
      .lean();

    return res.json({
      success: true,
      recipients: musicians.map((musician) => ({
        _id: musician._id,
        name: musicianDisplayName(musician),
        email: musician.email || "",
        phone: musician.phone || musician.phoneNormalized || "",
        profilePhoto: musician.profilePhoto || "",
      })),
    });
  } catch (error) {
    console.error("GET /api/messages/recipients failed:", error);
    return res.status(500).json({ success: false, message: "Failed to load recipients" });
  }
});

router.post("/start", musicianAuth, async (req, res) => {
  try {
    const { userRole, userId, firstName } = getActorFromReq(req);
    if (userRole !== "agent" && userRole !== "admin") {
      return res.status(403).json({ success: false, message: "Not authorised" });
    }

    const { musicianId, body } = req.body || {};
    if (!isObjectId(musicianId) || !String(body || "").trim()) {
      return res.status(400).json({
        success: false,
        message: "Choose a musician and enter a message",
      });
    }

    const musician = await Musician.findById(musicianId)
      .select("_id firstName lastName stageName email phone phoneNormalized")
      .lean();
    if (!musician) {
      return res.status(404).json({ success: false, message: "Musician not found" });
    }

    await addConversationMessage({
      musician,
      senderRole: "agent",
      senderName: firstName || "The Supreme Collective",
      senderId: userId,
      body,
    });

    const notificationSent = await notifyMusicianOfPortalMessage(musician);

    return res.status(201).json({ success: true, notificationSent });
  } catch (error) {
    console.error("POST /api/messages/start failed:", error);
    return res.status(500).json({ success: false, message: "Failed to start conversation" });
  }
});

/**
 * GET /api/messages
 * Agent/admin view
 */
router.get("/", musicianAuth, async (req, res) => {
  try {
    const { userRole } = getActorFromReq(req);

    if (userRole !== "agent" && userRole !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorised to view all messages",
      });
    }

    const [rows, conversations] = await Promise.all([
      Availability.find({
        $or: [
          { messageSidOut: { $exists: true, $ne: null } },
          { outboundMessage: { $exists: true, $ne: "" } },
          { "inbound.body": { $exists: true, $ne: "" } },
          { reply: { $in: ["yes", "no", "unavailable"] } },
          { websiteReplies: { $exists: true, $ne: [] } },
        ],
      })
        .sort({ updatedAt: -1 })
        .lean(),
      MessageConversation.find({}).sort({ updatedAt: -1 }).lean(),
    ]);

    const enrichedRows = await enrichRowsWithMusicianProfiles(rows);
    const threads = mergeConversationThreads(
      buildThreadsFromRows(enrichedRows),
      conversations,
      true,
    );

    return res.json({
      success: true,
      threads,
    });
  } catch (err) {
    console.error("GET /api/messages failed:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load messages",
    });
  }
});

/**
 * GET /api/messages/mine
 * Musician-only view
 */
router.get("/mine", musicianAuth, async (req, res) => {
  try {
    const { userId } = getActorFromReq(req);

    if (!isObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "No valid musician id found",
      });
    }

    const [rows, conversations] = await Promise.all([
      Availability.find({
        musicianId: userId,
        $or: [
          { messageSidOut: { $exists: true, $ne: null } },
          { outboundMessage: { $exists: true, $ne: "" } },
          { "inbound.body": { $exists: true, $ne: "" } },
          { reply: { $in: ["yes", "no", "unavailable"] } },
          { websiteReplies: { $exists: true, $ne: [] } },
        ],
      })
        .sort({ updatedAt: -1 })
        .lean(),
      MessageConversation.find({ musicianId: userId }).lean(),
    ]);

    const enrichedRows = await enrichRowsWithMusicianProfiles(rows);
    const threads = mergeConversationThreads(
      buildThreadsFromRows(enrichedRows),
      conversations,
      false,
    );

    return res.json({
      success: true,
      threads,
    });
  } catch (err) {
    console.error("GET /api/messages/mine failed:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load your messages",
    });
  }
});

/**
 * GET /api/messages/:threadId/twilio-history
 * Agent/admin-only, loaded on demand when a conversation is opened.
 */
router.get("/:threadId/twilio-history", musicianAuth, async (req, res) => {
  try {
    const { userRole } = getActorFromReq(req);
    if (userRole !== "agent" && userRole !== "admin") {
      return res.status(403).json({ success: false, message: "Not authorised" });
    }

    const threadId = String(req.params.threadId || "");
    const separatorIndex = threadId.indexOf("__");
    const threadType = separatorIndex >= 0 ? threadId.slice(0, separatorIndex) : "";
    const threadValue = separatorIndex >= 0 ? threadId.slice(separatorIndex + 2) : "";
    let phone = "";

    if (threadType === "person" && isObjectId(threadValue)) {
      const musician = await Musician.findById(threadValue)
        .select("phone phoneNormalized")
        .lean();
      phone = musician?.phone || musician?.phoneNormalized || "";

      if (!phone) {
        const row = await Availability.findOne({ musicianId: threadValue })
          .sort({ updatedAt: -1 })
          .select("phone")
          .lean();
        phone = row?.phone || "";
      }
    } else if (threadType === "phone") {
      phone = threadValue;
    } else {
      return res.status(400).json({ success: false, message: "Invalid thread id" });
    }

    if (!phone) {
      return res.json({ success: true, messages: [] });
    }

    const messages = await fetchTwilioConversation(phone);
    return res.json({ success: true, messages });
  } catch (error) {
    console.error("GET /api/messages/:threadId/twilio-history failed:", error);
    return res.status(502).json({
      success: false,
      message: "Could not load Twilio message history",
    });
  }
});


/**
 * POST /api/messages/message-reply
 * Website quick reply that mimics a WhatsApp availability response on a single row
 */
router.post("/message-reply", musicianAuth, async (req, res) => {
  try {
    const { userRole, userId } = getActorFromReq(req);
    const { rowId, requestId, reply, buttonText, buttonPayload } = req.body || {};

    if (!rowId || !isObjectId(rowId)) {
      return res.status(400).json({
        success: false,
        message: "A valid rowId is required",
      });
    }

    if (!["yes", "no", "noloc", "nolocation", "unavailable"].includes(String(reply || "").toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "A valid reply is required",
      });
    }

    const existingRow = await Availability.findById(rowId);

    if (!existingRow) {
      return res.status(404).json({
        success: false,
        message: "Message row not found",
      });
    }

    const isAgent = userRole === "agent" || userRole === "admin";
    const isOwnerMusician =
      isObjectId(userId) && String(existingRow.musicianId || "") === String(userId);

    if (!isAgent && !isOwnerMusician) {
      return res.status(403).json({
        success: false,
        message: "Not authorised to reply to this message",
      });
    }

    const normalizedReply = String(reply).toLowerCase();
    const fallbackText =
      normalizedReply === "yes"
        ? "I am available"
        : normalizedReply === "no" || normalizedReply === "noloc" || normalizedReply === "nolocation"
        ? "Not for this place"
        : "Unavailable this day";

    const inboundSid = `WEB-${Date.now()}`;

    const updated = await Availability.findByIdAndUpdate(
      rowId,
      {
        $set: {
          reply: normalizedReply,
          repliedAt: new Date(),
          "inbound.sid": inboundSid,
          "inbound.repliedSid": null,
          "inbound.body": buttonText || fallbackText,
          "inbound.buttonText": buttonText || fallbackText,
          "inbound.buttonPayload": buttonPayload || "",
          "inbound.source": "website-quick-reply",
          ...(requestId ? { requestId, "inbound.requestId": requestId } : {}),
        },
      },
      { new: true }
    );

    await processAvailabilityReplyFlow({
      updated,
      reply: normalizedReply,
      requestId: requestId || updated?.requestId || null,
      inboundSid,
      repliedSid: null,
      bodyText: buttonText || fallbackText,
      btnText: buttonText || fallbackText,
      btnId: buttonPayload || "",
      fromRaw: updated?.phone || "",
    });

    return res.json({
      success: true,
      message: "Quick reply processed",
    });
  } catch (err) {
    console.error("POST /api/messages/message-reply failed:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to process quick reply",
    });
  }
});

/**
 * POST /api/messages/:threadId/reply
 * Save a website reply against all availability rows in the thread
 */
router.post("/:threadId/reply", musicianAuth, async (req, res) => {
  try {
    const { userRole, userId, firstName } = getActorFromReq(req);
    const { body, senderName } = req.body || {};
    const threadId = String(req.params.threadId || "");

    if (!body || !String(body).trim()) {
      return res.status(400).json({
        success: false,
        message: "Reply body is required",
      });
    }

    const [threadType, threadValue] = threadId.split("__");

    if (!threadType || !threadValue) {
      return res.status(400).json({
        success: false,
        message: "Invalid thread id",
      });
    }

    const query = {};

    if (threadType === "person") {
      if (!isObjectId(threadValue)) {
        return res.status(400).json({
          success: false,
          message: "Invalid person thread id",
        });
      }
      query.musicianId = threadValue;
    } else if (threadType === "phone") {
      query.phone = threadValue;
    } else {
      return res.status(400).json({
        success: false,
        message: "Unsupported thread type",
      });
    }

    const matchedRows = await Availability.find(query);
    const musicianId =
      threadType === "person"
        ? threadValue
        : matchedRows.find((row) => row.musicianId)?.musicianId;

    if (!isObjectId(musicianId)) {
      return res.status(404).json({ success: false, message: "Message recipient not found" });
    }

    const isAgent = userRole === "agent" || userRole === "admin";
    const isOwnerMusician =
      isObjectId(userId) &&
      String(musicianId) === String(userId);

    if (!isAgent && !isOwnerMusician) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to reply to this thread",
      });
    }

    const musician = await Musician.findById(musicianId)
      .select("_id firstName lastName stageName email phone phoneNormalized")
      .lean();
    if (!musician) {
      return res.status(404).json({ success: false, message: "Musician not found" });
    }

    const conversation = await addConversationMessage({
      musician,
      senderRole: isAgent ? "agent" : "musician",
      senderName: isAgent
        ? String(senderName || firstName || "The Supreme Collective")
        : musicianDisplayName(musician),
      senderId: userId,
      body,
    });

    const replyPayload = conversation.messages.at(-1);
    const notificationSent = isAgent
      ? await notifyMusicianOfPortalMessage(musician)
      : false;

    return res.json({
      success: true,
      message: "Reply saved",
      reply: replyPayload,
      notificationSent,
    });
  } catch (err) {
    console.error("POST /api/messages/:threadId/reply failed:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to save reply",
    });
  }
});

/**
 * POST /api/messages/:threadId/mark-read
 * Optional helper for badge clearing
 */
router.post("/:threadId/mark-read", musicianAuth, async (req, res) => {
  try {
    const { userRole, userId } = getActorFromReq(req);
    const threadId = String(req.params.threadId || "");

    const [threadType, threadValue] = threadId.split("__");

    if (!threadType || !threadValue) {
      return res.status(400).json({
        success: false,
        message: "Invalid thread id",
      });
    }

    const query = {};

    if (threadType === "person") {
      if (!isObjectId(threadValue)) {
        return res.status(400).json({
          success: false,
          message: "Invalid person thread id",
        });
      }
      query.musicianId = threadValue;
    } else if (threadType === "phone") {
      query.phone = threadValue;
    } else {
      return res.status(400).json({
        success: false,
        message: "Unsupported thread type",
      });
    }

    const rows = await Availability.find(query);
    const musicianId =
      threadType === "person"
        ? threadValue
        : rows.find((row) => row.musicianId)?.musicianId;

    if (!isObjectId(musicianId)) {
      return res.status(404).json({ success: false, message: "Thread not found" });
    }

    const isAgent = userRole === "agent" || userRole === "admin";
    const isOwnerMusician =
      isObjectId(userId) &&
      String(musicianId) === String(userId);

    if (!isAgent && !isOwnerMusician) {
      return res.status(403).json({
        success: false,
        message: "Not authorised",
      });
    }

    for (const row of rows) {
      if (row.inbound?.body || row.reply) {
        row.set("inbound.readByAdmin", isAgent ? true : row.inbound?.readByAdmin);
        row.set("inbound.readByMusician", !isAgent ? true : row.inbound?.readByMusician);
      }
      row.websiteReplies = (row.websiteReplies || []).map((reply) => ({
        ...(reply?.toObject ? reply.toObject() : reply),
        readByAdmin: isAgent ? true : reply.readByAdmin,
        readByMusician: !isAgent ? true : reply.readByMusician,
      }));
      await row.save();
    }

    const readField = isAgent ? "messages.$[].readByAdmin" : "messages.$[].readByMusician";
    await MessageConversation.updateOne(
      { musicianId },
      { $set: { [readField]: true } },
    );

    return res.json({
      success: true,
      message: "Thread marked as read",
    });
  } catch (err) {
    console.error("POST /api/messages/:threadId/mark-read failed:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to mark thread as read",
    });
  }
});

export default router;
