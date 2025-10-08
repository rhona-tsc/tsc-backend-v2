// routes/twilio-webhook.ts
import express from "express";
import { updateMemberConfirmation, getDeputy, sendCalendarInvite } from "../services/bookingFlow.js";
import { sendConfirmed, sendDeclined } from "../services/messenger.js";

const router = express.Router();

router.post("/twilio/inbound", express.urlencoded({ extended: false }), async (req, res) => {
  const from = req.body.From;        // "whatsapp:+447..." or "+447..."
  const body = (req.body.Body || "").trim().toLowerCase();
  const isWhatsApp = from.startsWith("whatsapp:");
  const phone = isWhatsApp ? from.replace("whatsapp:", "") : from;

  // You’ll need a simple correlation store mapping phone → pending member job/booking
  const ctx = await findPendingContextByPhone(phone); // { bookingId, actId, memberId, channel, ... }
  if (!ctx) return res.sendStatus(200);

  if (["yes", "y"].includes(body)) {
    await updateMemberConfirmation(ctx, "yes");
    await sendConfirmed({ to: phone, channel: ctx.channel });
    await sendCalendarInvite(ctx); // email ICS or Google invite (see below)
  } else if (["no", "n"].includes(body)) {
    await updateMemberConfirmation(ctx, "no");
    await sendDeclined({ to: phone, channel: ctx.channel });
    // escalate to deputy
    const deputy = await getDeputy(ctx);
    if (deputy) await enqueueNotifyMember(deputy, ctx); // re-run same notify job
  } else {
    // Optional: guide
    // No state change
  }

  return res.sendStatus(200);
});

export default router;