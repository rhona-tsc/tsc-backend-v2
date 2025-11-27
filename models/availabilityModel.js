// models/availability.js
import mongoose from "mongoose";

const availabilitySchema = new mongoose.Schema(
  {
    enquiryId: { type: String, index: true },
    contactName: { type: String, default: "" },
    musicianName: { type: String, default: "" },
    actName: { type: String, default: "" },
    clientName: { type: String, default: "" },
    clientEmail: { type: String, default: "" },

    actId: { type: mongoose.Schema.Types.ObjectId, ref: "act", index: true },
    lineupId: { type: mongoose.Schema.Types.ObjectId, ref: "Lineup", index: true },
    musicianId: { type: mongoose.Schema.Types.ObjectId, ref: "Musician", index: true },

        isDeputy: { type: Boolean, default: false, index: true },

    // 🆕 Track which vocalist slot this record applies to (0, 1, etc.)
    slotIndex: { type: Number, default: 0, index: true },

    phone: {
      type: String,
      required: function () {
        return !!(this.actId && this.dateISO);
      },
      index: true,
    },

    duties: { type: String, default: "" },
    fee: { type: String, default: "" },
    formattedDate: { type: String, default: "" },
    formattedAddress: { type: String, default: "" },

    dateISO: { type: String, index: true },
    date: { type: Date },

    v2: { type: Boolean, default: false, index: true },

    reply: {
      type: String,
      enum: ["yes", "no", "unavailable", null],
      default: null,
    },

    messageSidOut: { type: String, index: true },
    messageSid: { type: String, select: false },

    status: {
      type: String,
      enum: [
        "pending",
        "queued",
        "sent",
        "delivered",
        "read",
        "undelivered",
        "failed",
      ],
      default: "queued",
    },

    repliedAt: { type: Date },

    inbound: {
      sid: { type: String },
      body: { type: String },
      buttonText: { type: String },
      buttonPayload: { type: String },
    },

    // 🔽 Google Calendar integration
    calendarEventId: { type: String, index: true },
    calendarInviteEmail: { type: String },
    calendarInviteSentAt: { type: Date },
    calendarDeclinedAt: { type: Date },
    calendarStatus: {
      type: String,
      enum: [
        "accepted",
        "needsAction",
        "tentative",
        "declined",
        "cancelled",
        null,
      ],
      default: null,
    },

    // 🆕 Extra fields (for booking confirmation tracking)
    calendarSummary: { type: String },
    calendarDescription: { type: String },
    confirmedBooking: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// ⚙️ Index adjustments
availabilitySchema.index(
  {
    actId: 1,
    
    lineupId: 1,
    dateISO: 1,
    phone: 1,
    v2: 1,
    slotIndex: 1, // 🆕 ensures uniqueness per vocalist slot
  },
  { unique: true }
);

const AvailabilityModel = mongoose.model("Availability", availabilitySchema);
export default AvailabilityModel;