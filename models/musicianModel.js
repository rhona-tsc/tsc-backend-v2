import mongoose from "mongoose";

const musicianSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["musician", "agent"],
      default: "musician",
    },

    tagLine: { type: String, maxlength: 160 },
    tscApprovedBio: { type: String },
    bio: { type: String },
    email: { type: String },
    firstName: { type: String },
    lastName: { type: String },
    phone: { type: String, index: true },
    phoneNormalized: { type: String, index: true },
    whatsappOptIn: { type: Boolean, default: false },
    password: { type: String },
    profilePhoto: { type: String, default: null },
    coverHeroImage: { type: String, default: null },

    basicInfo: {
      firstName: { type: String },
      lastName: { type: String },
      phone: { type: String },
      email: { type: String },
    },

    functionBandVideoLinks: [
      {
        title: { type: String, default: "" },
        url: { type: String, default: "" },
      },
    ],
    originalBandVideoLinks: [
      {
        title: { type: String, default: "" },
        url: { type: String, default: "" },
      },
    ],
    tscApprovedFunctionBandVideoLinks: [
      {
        title: { type: String, default: "" },
        url: { type: String, default: "" },
      },
    ],
    tscApprovedOriginalBandVideoLinks: [
      {
        title: { type: String, default: "" },
        url: { type: String, default: "" },
      },
    ],

    agreementCheckboxes: [
      {
        termsAndConditions: { type: Boolean, default: false },
        privacyPolicy: { type: Boolean, default: false },
      },
    ],

    address: {
      line1: { type: String, default: "" },
      line2: { type: String, default: "" },
      town: { type: String, default: "" },
      county: { type: String, default: "" },
      postcode: { type: String, default: "" },
      country: { type: String, default: "" },
    },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "Approved, changes pending"],
      default: "pending",
      set: (v) => (v === "" ? null : v),
    },

    academic_credentials: [
      {
        course: { type: String, default: "" },
        institution: { type: String, default: "" },
        years: { type: String, default: "" },
        education_level: { type: String, default: "" },
      },
    ],

    awards: [
      {
        description: { type: String, default: "" },
        years: { type: String, default: "" },
      },
    ],

    function_bands_performed_with: [
      { function_band_name: String, function_band_leader_email: String },
    ],
    original_bands_performed_with: [
      { original_band_name: String, original_band_leader_email: String },
    ],

    sessions: [
      {
        artist: { type: String, default: "" },
        session_type: { type: String, default: "" },
      },
    ],

    social_media_links: [
      {
        platform: { type: String, default: "" },
        url: { type: String, default: "" },
      },
    ],

    instrumentation: [
      {
        instrument: { type: String, default: "" },
        skill_level: {
          type: String,
          enum: ["Expert", "Intermediate", "Advanced"],
          default: null,
          required: false,
          set: (v) => (v === "" ? null : v),
        },
      },
    ],

    vocals: {
      type: {
        type: [String],
        enum: [
          "Lead Vocalist",
          "Backing Vocalist",
          "I don't sing",
          "Backing Vocalist-Instrumentalist",
          "Lead Vocalist-Instrumentalist",
        ],
        default: [],
        required: false,
        set: (v) => (v === "" ? [] : v),
      },

      gender: {
        type: String,
        enum: ["Male", "Female", "Other", ""],
        default: "",
      },
      range: {
        type: String,
        enum: ["Soprano", "Alto", "Tenor", "Mezzo-Soprano", ""],
        default: "",
      },

      rap: {
        type: String,
        default: "",
        required: false,
      },

      genres: {
        type: [String],
        default: [],
        required: false,
        set: (v) => (Array.isArray(v) ? v : []),
      },
    },

    other_skills: { type: [String], default: [] },
    logistics: { type: [String], default: [] },

    vocalMics: {
      wireless_vocal_mics: { type: String, default: null, set: (v) => (v === "" ? null : v) },
      wired_vocal_mics: { type: String, default: null, set: (v) => (v === "" ? null : v) },
      wireless_vocal_adapters: { type: String, default: null, set: (v) => (v === "" ? null : v) },
    },

    inEarMonitoring: {
      wired_in_ear_packs: { type: String, default: null, set: (v) => (v === "" ? null : v) },
      wireless_in_ear_packs: { type: String, default: null, set: (v) => (v === "" ? null : v) },
      in_ear_monitors: { type: String, default: null, set: (v) => (v === "" ? null : v) },
    },

    instrumentMics: {
      extra_wired_instrument_mics: { type: String, default: null, set: (v) => (v === "" ? null : v) },
      wireless_horn_mics: { type: String, default: null, set: (v) => (v === "" ? null : v) },
      drum_mic_kit: { type: String, default: null, set: (v) => (v === "" ? null : v) },
    },

    speechMics: {
      wireless_speech_mic: { type: String, default: null, set: (v) => (v === "" ? null : v) },
      wired_speech_mic: { type: String, default: null, set: (v) => (v === "" ? null : v) },
    },

    paSpeakerSpecs: [
      {
        name: { type: String, default: "" },
        quantity: { type: String, default: null, set: (v) => (v === "" ? null : v) },
        wattage: { type: Number, default: 0 },
      },
    ],

    mixingDesk: [{ name: { type: String, default: "" }, quantity: { type: String, default: null, set: (v) => (v === "" ? null : v) }, wattage: { type: Number, default: 0 } }],
    floorMonitorSpecs: [{ name: { type: String, default: "" }, quantity: { type: String, default: null, set: (v) => (v === "" ? null : v) }, wattage: { type: Number, default: 0 } }],

    backline: [{ name: { type: String, default: "" }, quantity: { type: String, default: null, set: (v) => (v === "" ? null : v) }, wattage: { type: Number, default: 0 } }],
    djGearRequired: [{ name: { type: String, default: "" }, quantity: { type: String, default: null, set: (v) => (v === "" ? null : v) }, wattage: { type: Number, default: 0 } }],
    instrumentSpecs: [{ name: { type: String, default: "" }, wattage: { type: Number, default: 0 } }],
    djEquipment: [{ name: { type: String, default: "" }, quantity: { type: String, default: null, set: (v) => (v === "" ? null : v) }, wattage: { type: Number, default: 0 } }],

    cableLogistics: [{ length: { type: String, default: "" }, quantity: { type: String, default: "" } }],
    extensionCableLogistics: [{ length: { type: String, default: "" }, quantity: { type: String, default: "" } }],

    uplights: [{ quantity: { type: String, default: null, set: (v) => (v === "" ? null : v) }, wattage: { type: Number, default: 0 } }],
    tbars: [{ quantity: { type: String, default: null, set: (v) => (v === "" ? null : v) }, wattage: { type: Number, default: 0 } }],
    lightBars: [{ quantity: { type: String, default: null, set: (v) => (v === "" ? null : v) }, wattage: { type: Number, default: 0 } }],
    discoBall: [{ quantity: { type: String, default: null, set: (v) => (v === "" ? null : v) }, wattage: { type: Number, default: 0 } }],
    otherLighting: [{ name: { type: String, default: "" }, quantity: { type: String, default: null, set: (v) => (v === "" ? null : v) }, wattage: { type: Number, default: 0 } }],

    djEquipmentCategories: [
      {
        hasDjTable: { type: Boolean, default: false },
        hasDjBooth: { type: Boolean, default: false },
        hasMixingConsole: { type: Boolean, default: false },
        hasCdjs: { type: Boolean, default: false },
        hasVinylDecks: { type: Boolean, default: false },
      },
    ],

    additionalEquipment: {
      mic_stands: { type: String, default: null, set: (v) => (v === "" ? null : v) },
      di_boxes: { type: String, default: null, set: (v) => (v === "" ? null : v) },
      wireless_guitar_jacks: { type: String, default: null, set: (v) => (v === "" ? null : v) },
    },

    digitalWardrobeBlackTie: { type: [String], default: [] },
    digitalWardrobeFormal: { type: [String], default: [] },
    digitalWardrobeSmartCasual: { type: [String], default: [] },
    digitalWardrobeSessionAllBlack: { type: [String], default: [] },
    additionalImages: { type: [String], default: [] },

    coverMp3s: { type: [{ title: String, url: String }], default: [] },
    originalMp3s: { type: [{ title: String, url: String }], default: [] },

    customRepertoire: { type: String, default: "" },
    selectedSongs: [
      {
        title: { type: String, default: "" },
        artist: { type: String, default: "" },
        genre: { type: String, default: "" },
        year: { type: String, default: null, set: (v) => (v === "" ? null : v) },
      },
    ],

    // ✅ Deputy / musician repertoire (used by moderation append route)
    // Stored as plain objects; year is numeric for consistent dedupe + sorting.
    repertoire: [
      {
        title: { type: String, default: "" },
        artist: { type: String, default: "" },
        genre: { type: String, default: "" },
        year: {
          type: Number,
          default: null,
          set: (v) => (v === "" || v == null ? null : Number(v)),
        },
      },
    ],

    deputy_contract_signed: { type: String, default: null, set: (v) => (v === "" ? null : v) },
    bank_account: {
      sort_code: { type: String, default: "", set: (v) => (v ?? "").toString().replace(/\D/g, "") },
      account_number: { type: String, default: "", set: (v) => (v ?? "").toString().replace(/\D/g, "") },
      account_name: { type: String, default: "" },
      account_type: { type: String, enum: ["Personal", "Business", ""], default: "" },
    },
    dateRegistered: { type: Date, default: Date.now },
  },

  { minimize: false, minimize: false, strict: true }
);

musicianSchema.index({ status: 1 });
musicianSchema.index({ "instrumentation.instrument": 1 });
musicianSchema.index({ other_skills: 1 });

const musicianModel =
  mongoose.models.musician || mongoose.model("musician", musicianSchema);

export default musicianModel;