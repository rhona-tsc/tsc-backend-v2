import mongoose from "mongoose";

const deputyPresentationSchema = new mongoose.Schema(
  {
    presentationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "deputyJob",
      required: true,
      index: true,
    },

    musicianId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "musician",
      required: true,
      index: true,
    },

    musicianSlug: {
      type: String,
      default: "",
      index: true,
    },

    presentedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    presentedByEmail: {
      type: String,
      default: "",
      index: true,
    },

    presentedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    emailSent: {
      type: Boolean,
      default: false,
    },

    viewCount: {
      type: Number,
      default: 0,
    },

    uniqueViewCount: {
      type: Number,
      default: 0,
    },

    lastViewedAt: {
      type: Date,
      default: null,
    },

    viewEvents: [
      {
        viewedAt: { type: Date, default: Date.now },
        ipHash: { type: String, default: "" },
        userAgent: { type: String, default: "" },
        referrer: { type: String, default: "" },
      },
    ],
  },
  { timestamps: true }
);

deputyPresentationSchema.index({ jobId: 1, musicianId: 1, presentedAt: -1 });

const deputyPresentationModel =
  mongoose.models.deputyPresentation ||
  mongoose.model("deputyPresentation", deputyPresentationSchema);

export default deputyPresentationModel;