import express from "express";
import mongoose from "mongoose";
import Availability from "../models/availability.js";
import musicianAuth from "../middleware/musicianAuth.js";

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

const buildFallbackOutboundBody = (row) => {
  const parts = [
    "Availability request sent",
    row.duties ? `for ${row.duties}` : "",
    row.formattedDate ? `on ${row.formattedDate}` : "",
    row.formattedAddress ? `at ${row.formattedAddress}` : "",
    row.fee ? `for £${row.fee}` : "",
  ].filter(Boolean);

  return parts.join(" ");
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
  const threadRef = row.requestId || row.enquiryId || row.requestKey || "no-enquiry";
  const actId = row.actId ? String(row.actId) : "no-act";
  const musicianId = row.musicianId ? String(row.musicianId) : "no-musician";
  const slotIndex = Number(row.slotIndex ?? 0);
  return `${threadRef}__${actId}__${musicianId}__${slotIndex}`;
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
      });
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

    return thread;
  });

  threads.sort((a, b) => {
    const aTime = toDateValue(a.latestMessage?.createdAt || a.updatedAt || a.outboundSentAt);
    const bTime = toDateValue(b.latestMessage?.createdAt || b.updatedAt || b.outboundSentAt);
    return bTime - aTime;
  });

  return threads;
};

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

    const rows = await Availability.find({
      $or: [
        { messageSidOut: { $exists: true, $ne: null } },
        { outboundMessage: { $exists: true, $ne: "" } },
        { "inbound.body": { $exists: true, $ne: "" } },
        { reply: { $in: ["yes", "no", "unavailable"] } },
        { websiteReplies: { $exists: true, $ne: [] } },
      ],
    })
      .sort({ updatedAt: -1 })
      .lean();

    const threads = buildThreadsFromRows(rows);

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

    const rows = await Availability.find({
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
      .lean();

    const threads = buildThreadsFromRows(rows);

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
 * POST /api/messages/:threadId/reply
 * Save a website reply against all availability rows in the thread
 */
router.post("/:threadId/reply", musicianAuth, async (req, res) => {
  try {
    const { userRole, userId, firstName } = getActorFromReq(req);
    const { body, senderRole, senderName } = req.body || {};
    const threadId = String(req.params.threadId || "");

    if (!body || !String(body).trim()) {
      return res.status(400).json({
        success: false,
        message: "Reply body is required",
      });
    }

    const parts = threadId.split("__");
    if (parts.length < 4) {
      return res.status(400).json({
        success: false,
        message: "Invalid thread id",
      });
    }

    const [enquiryId, actId, musicianId, slotIndexRaw] = parts;
    const slotIndex = Number(slotIndexRaw ?? 0);

    const query = {
      slotIndex,
    };

    if (enquiryId && enquiryId !== "no-enquiry") {
      query.$or = [
        { enquiryId },
        { requestId: enquiryId },
        { requestKey: enquiryId },
      ];
    }

    if (actId && actId !== "no-act" && isObjectId(actId)) {
      query.actId = actId;
    }

    if (musicianId && musicianId !== "no-musician" && isObjectId(musicianId)) {
      query.musicianId = musicianId;
    }

    const matchedRows = await Availability.find(query);

    if (!matchedRows.length) {
      return res.status(404).json({
        success: false,
        message: "Message thread not found",
      });
    }

    const isAgent = userRole === "agent" || userRole === "admin";
    const isOwnerMusician =
      isObjectId(userId) &&
      matchedRows.some((row) => String(row.musicianId) === String(userId));

    if (!isAgent && !isOwnerMusician) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to reply to this thread",
      });
    }

    const replyPayload = {
      body: String(body).trim(),
      senderRole: isAgent ? "agent" : "musician",
      senderName: String(senderName || firstName || (isAgent ? "Agent" : "Musician")),
      senderMusicianId: !isAgent && isObjectId(userId) ? userId : null,
      readByAdmin: isAgent,
      readByMusician: !isAgent,
      createdAt: new Date(),
    };

    await Availability.updateMany(
      { _id: { $in: matchedRows.map((row) => row._id) } },
      {
        $push: { websiteReplies: replyPayload },
      }
    );

    return res.json({
      success: true,
      message: "Reply saved",
      reply: replyPayload,
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

    const parts = threadId.split("__");
    if (parts.length < 4) {
      return res.status(400).json({
        success: false,
        message: "Invalid thread id",
      });
    }

    const [enquiryId, actId, musicianId, slotIndexRaw] = parts;
    const slotIndex = Number(slotIndexRaw ?? 0);

    const query = { slotIndex };

    if (enquiryId && enquiryId !== "no-enquiry") {
      query.$or = [
        { enquiryId },
        { requestId: enquiryId },
        { requestKey: enquiryId },
      ];
    }

    if (actId && actId !== "no-act" && isObjectId(actId)) {
      query.actId = actId;
    }

    if (musicianId && musicianId !== "no-musician" && isObjectId(musicianId)) {
      query.musicianId = musicianId;
    }

    const rows = await Availability.find(query);

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Thread not found",
      });
    }

    const isAgent = userRole === "agent" || userRole === "admin";
    const isOwnerMusician =
      isObjectId(userId) &&
      rows.some((row) => String(row.musicianId) === String(userId));

    if (!isAgent && !isOwnerMusician) {
      return res.status(403).json({
        success: false,
        message: "Not authorised",
      });
    }

    for (const row of rows) {
      row.websiteReplies = (row.websiteReplies || []).map((reply) => ({
        ...reply.toObject?.() ? reply.toObject() : reply,
        readByAdmin: isAgent ? true : reply.readByAdmin,
        readByMusician: !isAgent ? true : reply.readByMusician,
      }));
      await row.save();
    }

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