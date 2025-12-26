import mongoose from "mongoose";

const { Schema } = mongoose;

const TravelModelSchema = new Schema(
  {
    type: { type: String, enum: ["county", "per-mile", "mu"], index: true },
    useCountyTravelFee: { type: Boolean, default: false },
    costPerMile: { type: Number, default: 0 },
    hasCountyFees: { type: Boolean, default: false },
  },
  { _id: false }
);

const ActCardSchema = new Schema(
  {
    actId: { type: Schema.Types.ObjectId, ref: "Act", index: true, unique: true },

    // Names / status / hero
    tscName: { type: String, index: true },
    name: { type: String, index: true },
    status: { type: String, index: true }, // approved/pending/draft/trashed
    isTest: { type: Boolean, default: false, index: true },
    imageUrl: { type: String, default: "" },
minDisplayPrice: { type: Number, default: null, index: true },
    // Pricing / engagement
    basePrice: { type: Number, default: null, index: true }, // smallest lineup total (with margin)
    loveCount: { type: Number, default: 0 },
    amendmentPending: { type: Boolean, default: false },

    // Genres
    genres: { type: [String], default: [], alias: "genres_raw" },
    genresNormalized: { type: [String], default: [], index: true, alias: "genres_norm" },

    // Lineups & instruments
    lineupSizes: { type: [String], default: [], index: true }, // e.g. ["4-Piece","6-Piece"]
    smallestLineupSize: { type: Number, default: null, index: true }, // e.g. 4
    instruments: { type: [String], default: [], index: true }, // normalized instruments
    wirelessByInstrument: { type: Map, of: Boolean, default: {} },
    wirelessInstruments: { type: [String], default: [], index: true }, // derived keys with true

    // Tech / setup flags
    hasElectricDrums: { type: Boolean, default: false, index: true },
    hasIEMs: { type: Boolean, default: false, index: true },
    canMakeAcoustic: { type: Boolean, default: false, index: true },
    canRemoveDrums: { type: Boolean, default: false, index: true },
    minDb: { type: Number, default: null, index: true },

    // Set length support (from setupFlags)
    supports60: { type: Boolean, default: false, index: true },
    supports90: { type: Boolean, default: false, index: true },

    // PA / Lighting
    pa: { type: Schema.Types.Mixed, default: {} },
    lighting: { type: Schema.Types.Mixed, default: {}, alias: "light" },
    hasPA: { type: Boolean, default: false, index: true },        // derived from pa
    hasLighting: { type: Boolean, default: false, index: true },  // derived from lighting

    // Extras
    extras: { type: Schema.Types.Mixed, default: {} },
    extrasKeys: { type: [String], default: [], index: true }, // true/complimentary/price>0 keys

    // Ceremony / Afternoon offerings
    ceremony: { type: Schema.Types.Mixed, default: {} },  // e.g. {solo:true,duo:true,trio:false,fourPiece:false}
    afternoon: { type: Schema.Types.Mixed, default: {} },
    hasCeremonyOptions: { type: Boolean, default: false, index: true },
    hasAfternoonOptions: { type: Boolean, default: false, index: true },

    // Compliance
    pliAmount: { type: Number, default: 0 },

    // Travel
    travelModel: { type: TravelModelSchema, default: {} },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Fresh/featured
ActCardSchema.index({ status: 1, createdAt: -1 });

// Optional: simple text search across names
try {
  ActCardSchema.index({ tscName: "text", name: "text" });
} catch { /* single text index rule; ignore if already exists */ }

export default mongoose.model("ActCard", ActCardSchema);