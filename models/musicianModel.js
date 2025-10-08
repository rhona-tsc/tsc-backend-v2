import mongoose from "mongoose";



const musicianSchema = new mongoose.Schema(

  
  {
    role: {
      type: String,
      enum: ["musician", "agent"],
      default: "musician",
    },
    tagLine: { type: String, maxlength: 160 },
    email: { type: String },
    firstName: { type: String },
    lastName: { type: String },
    phone: { type: String, index: true },
    phoneNormalized: { type: String, index: true },
    password: { type: String },
    basicInfo: {
      firstName: { type: String },
      lastName: { type: String },

      phone: { type: String },
    },
    address: {
      line1: { type: String },
      line2: { type: String },
      town: { type: String },
      county: { type: String },
      postcode: { type: String },
      country: { type: String },
    },
    bio: { type: String },
    tscApprovedBio: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "Approved, changes pending"],
      default: "pending",
    },
    academic_credentials: [
      {
        course: { type: String },
        institution: { type: String },
        years: { type: String },
        education_level: { type: String },
      },
    ],
    paAndBackline: [
      {
        name: { type: String },
        wattage: { type: Number },
        quantity: { type: Number },
      },
    ],
    awards: [
      {
        description: { type: String },
        years: { type: String },
      },
    ],
    function_bands_performed_with: [
      {
        function_band_name: { type: String },
        function_band_leader_email: { type: String },
      },
    ],
    original_bands_performed_with: [
      {
        original_band_name: { type: String },
        original_band_leader_email: { type: String },
      },
    ],
    sessions: [
      {
        artist: { type: String },
        session_type: { type: String },
      },
    ],
    social_media_links: [
      {
        platform: { type: String },
        link: { type: String },
      },
    ],
    instrumentation: [
      {
        instrument: String,
        skill_level: {
          type: String,
          enum: ["Expert", "Intermediate", "Advanced"],
          required: false,
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
        required: false,
      },
      gender: {
        type: String,
        enum: ["Male", "Female", "Non-Binary"],
        required: false,
      },
      range: {
        type: String,
        enum: [
          "Soprano",
          "Mezzo-Soprano",
          "Alto",
          "Tenor",
          "Baritone",
          "Bass",
          "Not sure",
        ],
        required: false,
      },
      rap: {
        type: String,
        required: false,
      },
      genres: [String], // <-- make sure this is here!
    },
    other_skills: [String],
    logistics: [String],
    vocalMics: {
      wireless_vocal_mics: { type: String },
      wired_vocal_mics: { type: String },
      wireless_vocal_adapters: { type: String },
    },
    inEarMonitoring: {
      wired_in_ear_packs: { type: String },
      wireless_in_ear_packs: { type: String },
      in_ear_monitors: { type: String },
    },
    instrumentMics: {
      extra_wired_instrument_mics: { type: String },
      wireless_horn_mics: { type: String },
      drum_mic_kit: { type: String },
    },
    speechMics: {
      wireless_speech_mics: { type: String },
      wired_speech_mics: { type: String },
    },
    cableLogistics: [
      {
        length: { type: String },
        quantity: { type: String },
      },
    ],
    extensionCableLogistics: [
      {
        length: { type: String },
        quantity: { type: String },
      },
    ],
    additionalEquipment: {
      mic_stands: { type: String },
      di_boxes: { type: String },
      wireless_guitar_jacks: { type: String },
    },
    uplights: [
      {
        quantity: { type: String },
        wattage: { type: Number },
      },
    ],
    tbars: [
      {
        quantity: { type: String },
        wattage: { type: Number },
      },
    ],
    lightBars: [
      {
        quantity: { type: String },
        wattage: { type: Number },
      },
    ],
    discoBall: [
      {
        quantity: { type: String },
        wattage: { type: Number },
      },
    ],
    otherLighting: [
      {
        name: { type: String },
        quantity: { type: String },
        wattage: { type: Number },
      },
    ],
    paSpeakerSpecs: [
      {
        name: { type: String },
        quantity: { type: String },
        wattage: { type: Number },
      },
    ],
    mixingDesk: [
      {
        name: { type: String },
        quantity: { type: String },
        wattage: { type: Number },
      },
    ],
    floorMonitorSpecs: [
      {
        name: { type: String },
        quantity: { type: String },
        wattage: { type: Number },
      },
    ],
    djGearRequired: [
      {
        name: { type: String },
        quantity: { type: String },
        wattage: { type: Number },
      },
    ],
    instrumentSpecs: [
      {
        name: { type: String },

        wattage: { type: Number },
      },
    ],
    djEquipment: [
      {
        name: { type: String },
        quantity: { type: String },
        wattage: { type: Number },
      },
    ],
    backline: [
      {
        name: { type: String },
        quantity: { type: String },
        wattage: { type: Number },
      },
    ],
    djEquipmentCategories: [
      {
        hasDjTable: { type: Boolean },
        hasDjBooth: { type: Boolean },
        hasMixingConsole: { type: Boolean },
        hasCdjs: { type: Boolean },
        hasVinylDecks: { type: Boolean },
      },
    ],
    bank_account: {
      sort_code: { type: String },
      account_number: { type: String },
      account_name: { type: String },
      account_type: { type: String },
    },
    profilePicture: { type: String },
    coverHeroImage: { type: String },
    availability: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Availability" },
    ],

    // NEW: Media & visual assets
    digitalWardrobeBlackTie: [{ type: String }],
    digitalWardrobeFormal: [{ type: String }],
    digitalWardrobeSmartCasual: [{ type: String }],
    digitalWardrobeSessionAllBlack: [{ type: String }],
    additionalImages: [{ type: String }],

    // NEW: Videos & MP3s
    functionBandVideoLinks: [{ title: String, url: String }],
    tscApprovedFunctionBandVideoLinks: [{ title: String, url: String }],
    originalBandVideoLinks: [{ title: String, url: String }],
    tscApprovedOriginalBandVideoLinks: [{ title: String, url: String }],

    coverMp3s: [{ title: String, url: String }],
    originalMp3s: [{ title: String, url: String }],

    customRepertoire: { type: String },
repertoire: [{
  title: String,
  artist: String,
  year: Number,
  genre: String
}],
    selectedSongs: [
      {
        title: String,
        artist: String,
        genre: String,
        year: String,
      },
    ],
    pat: { type: Boolean },
    patExpiry: { type: Date },
    patFile: { type: String },
    pli: { type: Boolean },
    pliExpiry: { type: Date },
    pliFile: { type: String },
    pliAmount: { type: Number },
    deputy_contract_signed: { type: String },
    agreementCheckboxes: [
      {
        termsAndConditions: { type: Boolean },
        privacyPolicy: { type: Boolean },
      },
    ],
    
    dateRegistered: { type: Date, default: Date.now },
  },
  
  { minimize: false }
);

musicianSchema.pre('save', function(next) {
  const norm = (v = "") => {
    let s = String(v || "").replace(/\s+/g, "");
    if (!s) return "";
    if (s.startsWith("+")) return s;
    if (s.startsWith("07")) return s.replace(/^0/, "+44");
    if (s.startsWith("44")) return `+${s}`;
    return s;
  };
  if (this.isModified('phone') || this.isModified('phoneNumber')) {
    this.phoneNormalized = norm(this.phone || this.phoneNumber);
  }
  next();
});

const musicianModel =
  mongoose.models.musician || mongoose.model("musician", musicianSchema);

  musicianSchema.index({ status: 1 });
musicianSchema.index({ "instrumentation.instrument": 1 });
musicianSchema.index({ other_skills: 1 });

// Export this helper to use during form submission
export const sanitizeMp3sForSubmission = (mp3s) =>
  (mp3s || [])
    .filter((mp3) => mp3.title || mp3.url)
    .map(({ title, url }) => ({
      title: title || "",
      url: url || "",
    }));

export default musicianModel;
