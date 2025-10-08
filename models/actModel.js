import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const AvailabilityDeputySchema = new mongoose.Schema(
  {
    musicianId: { type: String, default: "" },
    vocalistName: { type: String, default: "" },
    photoUrl: { type: String, default: "" },        // cropped/approved image if you have it
    profilePicture: { type: String, default: "" },  // raw profile picture fallback (optional)
    profileUrl: { type: String, default: "" },      // /musician/:id link (optional)
    setAt: { type: Date, default: null },
  },
  { _id: false }
);

const AvailabilityBadgeSchema = new mongoose.Schema(
  {
    active: { type: Boolean, default: false },
    isDeputy: { type: Boolean, default: false },     // for the lead slot when it's a deputy
    vocalistName: { type: String, default: "" },     // lead/deputy name currently featured
    musicianId: { type: String, default: "" },       // lead/deputy musician id currently featured
    inPromo: { type: Boolean, default: false },
    dateISO: { type: String, default: "" },
    address: { type: String, default: "" },
    setAt: { type: Date, default: null },
    photoUrl: { type: String, default: "" },

    // NEW: the shortlist of deputies who replied YES
    deputies: { type: [AvailabilityDeputySchema], default: [] },
  },
  { _id: false }
);

const ActAvailabilitySchema = new mongoose.Schema(
  {
    dateISO:    { type: String, index: true },                               // "YYYY-MM-DD"
    status:     { type: String, enum: ["available", "unavailable"], index: true },
    setAt:      { type: Date, default: Date.now },
    setBy: {
      musicianId: { type: String, default: "" },
      name:       { type: String, default: "" },
      phone:      { type: String, default: "" },
      channel:    { type: String, default: "whatsapp" }, // optional
    },
    note:       { type: String, default: "" }, // optional
  },
  { _id: false }
);

const actSchema = new mongoose.Schema(
  {
    name: { type: String },
    tscName: { type: String },
    description: { type: String },
    tscDescription: { type: String },
    tscBio: { type: String },
    tscVideos: [
      {
        title: { type: String, default: "" },
        url: { type: String, required: true },
      },
    ],
    amendmentDraft: {
      type: mongoose.Schema.Types.Mixed, // store object with the updated fields
      default: null,
    },
    lastAmended: {
      type: Date,
    },
    pendingChanges: {
      type: Object,
      default: null,
    },
    status: {
      type: String,
      enum: [
        "draft",
        "pending",
        "approved",
        "live",
        "Approved, changes pending",
        "trashed",
      ],
      default: "draft",
    },
    amendment: {
      isPending: { type: Boolean, default: false },
      changes: { type: Object, default: {} },
      lastEditedBy: { type: String, default: "" },
      lastEditedAt: { type: Date },
    },
    bio: { type: String },
    images: [
      {
        title: { type: String, default: "" },
        url: { type: String, required: true },
      },
    ],
    coverImage: [
      {
        title: { type: String, default: "" },
        url: { type: String, required: true },
      },
    ],
    profileImage: [
      {
        title: { type: String, default: "" },
        url: { type: String, required: true },
      },
    ],
    videos: [
      {
        title: { type: String, default: "" },
        url: { type: String, required: true },
      },
    ],
    mp3s: [
      {
        title: { type: String, default: "" },
        url: { type: String, required: true },
      },
    ],
    genre: [{ type: String }], // Array of genres
    numberOfSets: [{ type: Number }],
    lengthOfSets: [{ type: Number }],
    minimumIntervalLength: [{ type: Number }],
    customRepertoire: { type: String },
    selectedSongs: [
      {
        year: { type: Number },
        title: { type: String },
        artist: { type: String },
        genre: { type: String },
      },
    ],
    pli: { type: Boolean },
    pliAmount: { type: Number },
    pliExpiry: { type: Date },
    pliFile: { type: String },
    usesGenericRiskAssessment: { type: Boolean, default: false },
    patCert: { type: Boolean },
    patExpiry: { type: Date },
    patFile: { type: String },
    riskAssessment: { type: String },
    isPercentage: { type: Boolean },
    vatRegistered: { type: Boolean },
    bestseller: { type: Boolean },

    paSystem: { type: String },
    setlist: { type: String },
    offRepertoireRequests: { type: Number },
    lightingSystem: { type: String },
    dateRegistered: { type: Date, default: Date.now },
    dateApproved: { type: Date },
    dateDeleted: { type: Date },
    timesShortlisted: { type: Number, default: 0 },
    timesBooked: { type: Number, default: 0 },
    numberOfShortlistsIn: { type: Number, default: 0 },
    discountToClient: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    createdByName: { type: String, index: true }, // ✅ indexed for faster lookup
    createdByEmail: { type: String, index: true }, // ✅ indexed for search/filter
    useMUTravelRates: { type: Boolean },
    useCountyTravelFee: { type: Boolean },
    useDifferentTeamForNorthernGigs: {
      type: Boolean,
      default: false,
    },
    northernTeam: [
      {
        firstName: { type: String },
        lastName: { type: String },
        phoneNumber: { type: String },
        phoneNormalized: { type: String, index: true },
        email: { type: String },
        instrument: { type: String },
        useMURatesForFees: { type: Boolean },
        fee: { type: Number },
        additionalFee: { type: [Number] },
        sortCode: { type: String },
        accountNumber: { type: String },
        accountName: { type: String },
        dietaryRequirements: { type: String },
        postCode: { type: String },
        carRegistration: { type: String },
        canDJ: { type: Boolean },
        haveMixingConsoleOrDecks: { type: Boolean },
        hasDjTable: { type: Boolean },
        haveBooth: { type: Boolean },
        wireless: { type: Boolean },
        inPromo: { type: Boolean },
        haveSoloPa: { type: Boolean },
        haveDuoPa: { type: Boolean },
        additionalEquipment: [
          {
            equipment: String,
            customEquipment: String,
            quantity: String,
            wattage: String,
          },
        ],
        deputies: [
          {
            firstName: { type: String },
            lastName: { type: String },
            phoneNumber: { type: String },
            phoneNormalized: { type: String },
            email: { type: String },
          },
        ],
      },
    ],
    countyFees: {
      type: Map,
      of: Number, // Store only counties with values
    },

    costPerMile: { type: Number },

    extras: {
      type: Map,
      of: new mongoose.Schema({
        price: { type: Number, default: 0 },
        complimentary: { type: Boolean, default: false },
      }),
      default: {},
    },
    reviews: [
      {
        clientFirstName: { type: String },
        clientLastName: { type: String },
        clientProfilePhoto: { type: String },
        eventType: { type: String },
        eventLocation: { type: String },
        clientEmail: { type: String },
        rating: { type: Number, min: 1, max: 5 },
        comment: { type: String },
        eventDate: { type: Date, default: Date.now },
        verified: { type: Boolean, default: false },
        // Store event media as array of URLs (to be set after upload)
        eventMedia: [String],
      },
    ],
    lineups: [
      {
        lineupId: { type: String, default: () => uuidv4(), index: true },
        actSize: { type: String },
        spaceRequired: { type: String },
        coverOverhead: { type: Boolean },
        dryAndLevel: { type: Boolean },
        setupTime: { type: Number },
        soundcheckTime: { type: Number },
        totalSetupAndSoundcheckTime: { type: Number },
        packdownTime: { type: Number },
        db: { type: String },
        electricityRequirements: { type: String },
        hotMeal: { type: Number },
        parking: { type: Number },
        changingRoom: { type: Boolean },
        rider: { type: [String] },
        hasDrums: { type: [Boolean] },
        iems: { type: Boolean },
        ampless: { type: Boolean },
        withoutDrums: { type: Boolean },
        acoustic: { type: Boolean },
        anotherVocalist: { type: Boolean },
        eDrums: { type: Boolean },
        roamingPercussion: { type: Boolean },
        ceremonySets: {
          type: Map,
          of: new mongoose.Schema(
            {
              unplugged: [String],
              amplified: [String],
              "amplified with backing tracks": [String],
            },
            { _id: false }
          ),
          default: {},
        },

        bandMembers: [
          {
            firstName: { type: String },
            lastName: { type: String },
            phoneNumber: { type: String },
            phoneNormalized: { type: String },
            email: { type: String },
            instrument: { type: String },
            useMURatesForFees: { type: Boolean },
            fee: { type: Number },
            additionalRoles: [
              {
                additionalFee: { type: Number },
                role: { type: String },
                isEssential: { type: Boolean, default: false },
              },
            ],
            sortCode: { type: String },
            accountNumber: { type: String },
            accountName: { type: String },
            dietaryRequirements: { type: String },
            postCode: { type: String },
             carRegistration: { type: String },
    carRegistrationValue: { type: String },
musicianProfileImageUpload: { type: String },
            canDJ: { type: Boolean },
            haveMixingConsoleOrDecks: { type: Boolean },
            hasDjTable: { type: Boolean },
            haveBooth: { type: Boolean },
            wireless: { type: Boolean },
            inPromo: { type: Boolean },
            haveSoloPa: { type: Boolean },
            haveDuoPa: { type: Boolean },
            isEssential: { type: Boolean, default: false },
            maxDJHoursPerDay: { type: Number },
            deputies: [
              {
                firstName: { type: String },
                lastName: { type: String },
                phoneNumber: { type: String },
                phoneNormalized: { type: String },
                email: { type: String },
              },
            ],
          },
        ],
        base_fee: [
          {
            act_size: { type: String },
            total_fee: { type: Number },
            fee_allocations: {
              type: Map,
              of: Number,
              default: {},
            },
          },
        ],
      },
    ],
    availabilityByDate: { type: [ActAvailabilitySchema], default: [] },
availabilityBadge: { type: AvailabilityBadgeSchema, default: () => ({}) },
  },
  { timestamps: true }
);



// --- helper: E.164-ish normaliser (+44…)
function normalizePhoneE164(raw = "") {
  let s = String(raw || "").trim().replace(/^whatsapp:/i, "").replace(/\s+/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("07")) return s.replace(/^0/, "+44");
  if (s.startsWith("44")) return `+${s}`;
  return s;
}

// Populate phoneNormalized for band members and deputies before save
actSchema.pre("save", function phoneNormaliser(next) {
  if (!Array.isArray(this.lineups)) return next();
  this.lineups = this.lineups.map((lineup) => {
    if (!Array.isArray(lineup.bandMembers)) return lineup;
    lineup.bandMembers = lineup.bandMembers.map((m) => {
      if (m) {
        const src = m.phoneNumber || m.phone || "";
        m.phoneNormalized = normalizePhoneE164(src);
        if (Array.isArray(m.deputies)) {
          m.deputies = m.deputies.map((d) => {
            if (!d) return d;
            const dsrc = d.phoneNumber || d.phone || "";
            d.phoneNormalized = normalizePhoneE164(dsrc);
            return d;
          });
        }
      }
      return m;
    });
    return lineup;
  });
  next();
});



actSchema.pre("save", function (next) {
  if (Array.isArray(this.lineups)) {
    const seen = new Set();
    this.lineups.forEach((lineup) => {
      if (!lineup.lineupId) lineup.lineupId = uuidv4();

      // Avoid duplicates within the same doc
      if (seen.has(lineup.lineupId)) {
        lineup.lineupId = uuidv4();
      }
      seen.add(lineup.lineupId);
    });
  }
  next();
});

actSchema.pre("save", function (next) {
  if (Array.isArray(this.lineups)) {
    const seen = new Set();
    this.lineups.forEach((lineup) => {
      if (!lineup.lineupId) lineup.lineupId = uuidv4();

      // Avoid duplicates within the same doc
      if (seen.has(lineup.lineupId)) {
        lineup.lineupId = uuidv4();
      }
      seen.add(lineup.lineupId);
    });
  }
  next();
});

// Normalize car registration: if a member selected "HAS_CAR" and provided a carRegistrationValue,
// persist the actual plate into carRegistration before save.
actSchema.pre("save", function (next) {
  if (Array.isArray(this.lineups)) {
    this.lineups = this.lineups.map((lineup) => {
      if (!Array.isArray(lineup.bandMembers)) return lineup;
      lineup.bandMembers = lineup.bandMembers.map((member) => {
        try {
          const mode = member?.carRegistration;
          const value = (member?.carRegistrationValue || "").trim();
          if (mode === "HAS_CAR" && value) {
            // ✅ Save the actual reg into carRegistration
            member.carRegistration = value.toUpperCase();
          }
        } catch (e) {
          // ignore
        }
        return member;
      });
      return lineup;
    });
  }
  next();
});
const actModel = mongoose.models.act || mongoose.model("act", actSchema);

export default actModel;
