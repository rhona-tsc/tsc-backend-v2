// models/EnquiryMessage.js
import mongoose from "mongoose";

const enquiryMessageSchema = new mongoose.Schema(
  {
    actId:      { type: mongoose.Schema.Types.ObjectId, ref: "Act", required: true },
    lineupId:   { type: mongoose.Schema.Types.ObjectId, ref: "Lineup", default: null },
    musicianId: { type: mongoose.Schema.Types.ObjectId, ref: "Musician", required: true },

    enquiryId:  { type: String, index: true }, // correlation id used in payloads

    phone:            { type: String, required: true },
    duties:           { type: String },
    fee:              { type: String },
    formattedDate:    { type: String },
    formattedAddress: { type: String },

    // Twilio message SID for the outbound template
    messageSid: { type: String, index: true }, // index only once (avoid dup-index elsewhere)

    /**
     * ✅ NEW: Transport status is separate from the musician reply.
     * Keep this purely for Twilio delivery/lifecycle.
     */
    deliveryStatus: {
      type: String,
      enum: ["queued", "sent", "delivered", "read", "undelivered", "failed"],
      default: "queued",
      index: true,
    },

    /**
     * (Optional legacy) If other code still writes/reads `status`,
     * keep it but prefer `deliveryStatus` going forward.
     */
    status: {
      type: String,
      enum: ["queued", "sent", "delivered", "read", "undelivered", "failed", "yes", "no", "unavailable"],
      default: "queued",
    },

    // Musician’s semantic reply
    reply: {
      type: String,
      enum: ["yes", "no", "unavailable"],
    },
    repliedAt: { type: Date },

    // Metadata for matching / diagnostics
    meta: {
      actName: String,
      MetaActId: String,
      MetaISODate: String,   // yyyy-mm-dd
      MetaAddress: String,
    },

    // 🗓️ Google Calendar integration
    calendar: {
      eventId:        { type: String, index: true }, // Google event.id
      attendeeEmail:  { type: String },
      calendarStatus: {
        type: String,
        enum: ["needsAction", "accepted", "declined", "tentative", "cancelled"],
        default: "needsAction",
      },
      inviteSentAt:     { type: Date },
      declinedAt:       { type: Date },
      // Optional mirrors so UI can show current event state without refetch
      summary:          { type: String }, // e.g. "TSC: Enquiry" / "TSC: Confirmed Booking"
      description:      { type: String },
      confirmedBooking: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

const EnquiryMessage = mongoose.model("EnquiryMessage", enquiryMessageSchema);
export default EnquiryMessage;