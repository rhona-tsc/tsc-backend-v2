// models/availability.js
import mongoose from "mongoose";

const availabilitySchema = new mongoose.Schema(
  {
    enquiryId: { type: String, index: true }, // already here
    contactName: { type: String, default: "" },
    musicianName: { type: String, default: "" },
    actName: { type: String, default: "" },

    actId: { type: mongoose.Schema.Types.ObjectId, ref: "Act" },
    lineupId: { type: mongoose.Schema.Types.ObjectId, ref: "Lineup" },
    musicianId: { type: mongoose.Schema.Types.ObjectId, ref: "Musician" },

    phone: { type: String, required: true },
    duties: { type: String, default: "" },
    fee: { type: String, default: "" },
    formattedDate: { type: String, default: "" },
    formattedAddress: { type: String, default: "" },

    dateISO: { type: String },
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
      enum: ["queued", "sent", "delivered", "read", "undelivered", "failed"],
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

    // 🆕 Extra fields (so you can reuse + confirm bookings)
    calendarSummary: { type: String }, // current event summary (e.g. "TSC: Enquiry", "TSC: Confirmed Booking")
    calendarDescription: { type: String }, // latest description text
    confirmedBooking: { type: Boolean, default: false }, // flip to true when booking confirmed
  },
  { timestamps: true }
);

availabilitySchema.index({ actId: 1, dateISO: 1, phone: 1, v2: 1 });

const AvailabilityModel = mongoose.model("Availability", availabilitySchema);
export default AvailabilityModel;
