// models/actFilterCard.model.js
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

/* ---------- tiny embedded schemas (no _id) ---------- */
const AdditionalRoleLiteSchema = new mongoose.Schema(
  {
    additionalFee: { type: Number, default: 0 },
    isEssential: { type: Boolean, default: false },
  },
  { _id: false }
);

const BandMemberLiteSchema = new mongoose.Schema(
  {
    fee: { type: Number, default: 0 },
    additionalRoles: { type: [AdditionalRoleLiteSchema], default: [] },
  },
  { _id: false }
);

const BaseFeeLiteSchema = new mongoose.Schema(
  {
    act_size: { type: String },
    total_fee: { type: Number },
    fee_allocations: { type: Map, of: Number, default: {} },
  },
  { _id: false }
);

const LineupLiteSchema = new mongoose.Schema(
  {
    lineupId: { type: String, default: () => uuidv4(), index: true },
    actSize: { type: String }, // e.g. "4-Piece"
    bandMembers: { type: [BandMemberLiteSchema], default: [] },
    base_fee: { type: [BaseFeeLiteSchema], default: [] },
  },
  { _id: false }
);

/* ----------------------- main schema ----------------------- */
const ActFilterCardSchema = new mongoose.Schema(
  {
    actId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Act",
      index: true,
      required: true,
    },

    // identity / status
    name: String,
    tscName: String,
    status: { type: String, index: true }, // approved/live/pending/draft
    isTest: { type: Boolean, default: false, index: true },

    // hero image (string URL)
    imageUrl: { type: String, default: "" },

    // pricing helpers
    basePrice: { type: Number, default: null },
    loveCount: { type: Number, default: 0 },
    amendmentPending: { type: Boolean, default: false },

    /* 🔎 repertoire search */
    repertoireTokens: { type: [String], default: [] }, // individual word tokens
    artistTokens: { type: [String], default: [] },     // individual word tokens
    songPhrases: { type: [String], default: [] },      // full song titles (lowercased)
    artistPhrases: { type: [String], default: [] },    // full artist names (lowercased)

    /* taxonomy */
    genres: { type: [String], default: [] },
    lineupSizes: { type: [String], default: [] },
    instruments: { type: [String], default: [] },

    /* wireless */
    wirelessByInstrument: { type: Map, of: Boolean, default: {} },

    /* tech / stagecraft */
    hasElectricDrums: Boolean,
    hasIEMs: Boolean,
    canMakeAcoustic: Boolean,
    canRemoveDrums: Boolean,
    minDb: Number,

    /* setup */
    setupSupports60: Boolean,
    setupSupports90: Boolean,
    hasSpeedySetup: Boolean,

    /* PA & lights */
    pa: { small: Boolean, medium: Boolean, large: Boolean },
    light: { small: Boolean, medium: Boolean, large: Boolean },

    /* compliance */
    pliAmount: Number,

    /* extras flags */
    extras: { type: Map, of: Boolean, default: {} },
    extrasKeys: { type: [String], default: [] },

    /* ceremony & afternoon */
    ceremony: { solo: Boolean, duo: Boolean, trio: Boolean, fourpiece: Boolean },
    afternoon: { solo: Boolean, duo: Boolean, trio: Boolean, fourpiece: Boolean },

    /* travel (both top-level and summary for flexibility) */
    useCountyTravelFee: { type: Boolean, default: false },
    costPerMile: { type: Number, default: 0 },
    countyFees: { type: Map, of: Number, default: undefined },

    travelModel: {
      type: { type: String, enum: ["county", "per-mile", "mu", null], default: null },
      useCountyTravelFee: Boolean,
      costPerMile: Number,
      hasCountyFees: Boolean,
    },

    /* ✅ minimal lineups needed for local pricing fallback */
    lineups: { type: [LineupLiteSchema], default: [] },

    smallestLineupSize: Number,
    genresNormalized: { type: [String], default: [] },
  },
  { timestamps: true }
);

/* ------------------------- indexes ------------------------- */
ActFilterCardSchema.index({ status: 1, isTest: 1 });
ActFilterCardSchema.index({ genres: 1 });
ActFilterCardSchema.index({ instruments: 1 });
ActFilterCardSchema.index({ lineupSizes: 1 });
ActFilterCardSchema.index({ pliAmount: 1 });
ActFilterCardSchema.index({ minDb: 1 });

ActFilterCardSchema.index({ "extras.$**": 1 });
ActFilterCardSchema.index({ "wirelessByInstrument.$**": 1 });

/* repertoire search */
ActFilterCardSchema.index({ repertoireTokens: 1 });
ActFilterCardSchema.index({ artistTokens: 1 });
ActFilterCardSchema.index({ songPhrases: 1 });
ActFilterCardSchema.index({ artistPhrases: 1 });

/* optional name text index */
ActFilterCardSchema.index({ name: "text", tscName: "text" });

const ActFilterCard =
  mongoose.models.ActFilterCard ||
  mongoose.model("ActFilterCard", ActFilterCardSchema);

export default ActFilterCard;