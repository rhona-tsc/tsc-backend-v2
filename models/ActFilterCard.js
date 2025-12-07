const mongoose = require("mongoose");

const ActFilterCardSchema = new mongoose.Schema(
  {
    actId: { type: mongoose.Schema.Types.ObjectId, ref: "Act", index: true, required: true },
    name: String,
    tscName: String,
    status: { type: String, index: true },     // e.g. "approved", "live", ...
    isTest: { type: Boolean, default: false, index: true },

    genres: { type: [String], index: true },   // ["Soul & Motown", ...]
    lineupSizes: { type: [String], index: true }, // ["Solo","Duo","Trio","4-Piece",...]

    instruments: { type: [String], index: true }, // canonical labels

    // Wireless support by instrument
    wirelessByInstrument: { type: Map, of: Boolean },

    // Sound limiter / stagecraft
    hasElectricDrums: Boolean,
    hasIEMs: Boolean,
    canMakeAcoustic: Boolean,
    canRemoveDrums: Boolean,
    minDb: Number, // minimum workable dB across lineups

    // Setup/Soundcheck
    setupSupports60: Boolean,
    setupSupports90: Boolean,
    hasSpeedySetup: Boolean,

    // PA & Lights
    pa: {
      small: Boolean,
      medium: Boolean,
      large: Boolean,
    },
    light: {
      small: Boolean,
      medium: Boolean,
      large: Boolean,
    },

    // PLI
    pliAmount: Number,

    // Extras presence flags
    extras: { type: Map, of: Boolean }, // keys like "background_music_playlist", "add_another_vocalist", ...

    // Ceremony & Afternoon
    ceremony: { solo: Boolean, duo: Boolean, trio: Boolean, fourpiece: Boolean },
    afternoon: { solo: Boolean, duo: Boolean, trio: Boolean, fourpiece: Boolean },

    // Travel summary (for UI hints)
    travelModel: {
      type: { type: String, enum: ["county", "per-mile", "mu", null], default: null },
      useCountyTravelFee: Boolean,
      costPerMile: Number,
      hasCountyFees: Boolean,
    },

    smallestLineupSize: Number,
  },
  { timestamps: true }
);

// Helpful compound indexes
ActFilterCardSchema.index({ status: 1, isTest: 1 });
ActFilterCardSchema.index({ genres: 1 });
ActFilterCardSchema.index({ instruments: 1 });
ActFilterCardSchema.index({ lineupSizes: 1 });
ActFilterCardSchema.index({ pliAmount: 1 });
ActFilterCardSchema.index({ minDb: 1 });

module.exports = mongoose.model("ActFilterCard", ActFilterCardSchema);