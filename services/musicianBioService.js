import crypto from "crypto";
import OpenAI from "openai";
import musicianModel from "../models/musicianModel.js";

const clean = (value) => String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const compact = (value) => {
  if (Array.isArray(value)) return value.map(compact).filter((item) => item !== "" && item != null);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compact(item)]).filter(([, item]) => item !== "" && item != null && (!Array.isArray(item) || item.length)));
  }
  return typeof value === "string" ? clean(value) : value;
};

export const buildMusicianBioSource = (musician) => compact({
  firstName: musician.firstName,
  submittedBio: musician.bio,
  tagline: musician.tagLine,
  instruments: musician.instrumentation,
  vocals: musician.vocals,
  skills: musician.other_skills,
  repertoire: musician.selectedSongs,
  customRepertoire: musician.customRepertoire,
  academicCredentials: musician.academic_credentials,
  awards: musician.awards,
  sessions: musician.sessions,
  functionBandExperienceCount: Array.isArray(musician.function_bands_performed_with)
    ? musician.function_bands_performed_with.length
    : 0,
  originalProjectExperienceCount: Array.isArray(musician.original_bands_performed_with)
    ? musician.original_bands_performed_with.length
    : 0,
  equipment: {
    paAndBackline: musician.paAndBackline,
    backline: musician.backline,
    djing: musician.djing,
    logistics: musician.logistics,
  },
  reviews: (musician.reviews || []).map((review) => ({ comment: review.comment, rating: review.rating })),
});

const hashSource = (source) => crypto.createHash("sha256").update(JSON.stringify(source)).digest("hex");

const privateTerms = (musician) => [
  musician.lastName,
  ...(musician.function_bands_performed_with || []).flatMap((item) => [item?.function_band_name, item?.function_band_leader_email]),
  ...(musician.original_bands_performed_with || []).flatMap((item) => [item?.original_band_name, item?.original_band_leader_email]),
]
  .map((item) => clean(item).toLowerCase())
  .filter((item) => item.length >= 4);

const assertPublicBioIsPrivate = (biography, musician) => {
  const lower = biography.toLowerCase();
  const matchedTerm = privateTerms(musician).find((term) => lower.includes(term));
  if (matchedTerm) throw new Error("Generated biography contained a private or identifying name");
  if (/https?:\/\/|www\.|@[a-z0-9._-]+|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i.test(biography)) {
    throw new Error("Generated biography contained contact or social details");
  }
};

const hasUsefulSource = (source) => clean(source.submittedBio).length >= 40 ||
  (Array.isArray(source.repertoire) && source.repertoire.length >= 3) ||
  (Array.isArray(source.instruments) && source.instruments.length > 0);

export const generateAndPublishMusicianBio = async (musicianId, { force = false } = {}) => {
  const musician = await musicianModel.findById(musicianId);
  if (!musician) return { generated: false, reason: "musician_not_found" };

  const existingBio = clean(musician.tscApprovedBio);
  const sourceIsAi = musician.approvedBioSource === "ai";
  if (!force && existingBio && !sourceIsAi) {
    return { generated: false, reason: "manual_bio_preserved" };
  }

  const source = buildMusicianBioSource(musician.toObject());
  if (!hasUsefulSource(source)) return { generated: false, reason: "insufficient_profile_information" };

  const sourceHash = hashSource(source);
  if (!force && sourceIsAi && musician.aiBioSourceHash === sourceHash) {
    return { generated: false, reason: "source_unchanged" };
  }

  if (!process.env.OPENAI_API_KEY) {
    await musicianModel.updateOne(
      { _id: musician._id },
      { $set: { aiBioGenerationError: "OPENAI_API_KEY is not configured" } },
      { runValidators: false },
    );
    return { generated: false, reason: "ai_not_configured" };
  }

  const model = process.env.OPENAI_BIO_MODEL || "gpt-4o-mini";
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.45,
      messages: [
        {
          role: "system",
          content: "You write premium, warm and factual musician profile biographies for The Supreme Collective, a UK live-music agency. Write 2-4 concise paragraphs in British English and third person. Refer to the musician by FIRST NAME ONLY and never use their surname or full name. Use only facts in the supplied profile. Never invent credits, venues, clients, qualifications, achievements, repertoire or years of experience. Protect the musician's identity: never include stage names, original artist/project names, band names, specific employer/client names, social handles, exact venue names, email addresses, phone numbers, URLs, bank details, exact locations or any detail that would make them readily searchable online. Generalise sensitive credits (for example, 'experienced across function bands and original projects'). Bold a small number of important skills or selling points using **double asterisks**. Do not add a heading or bullets and do not mention that AI wrote the biography.",
        },
        {
          role: "user",
          content: `Create the public musician biography from this application data:\n${JSON.stringify(source)}`,
        },
      ],
    });

    const biography = clean(completion.choices?.[0]?.message?.content);
    if (biography.length < 80) throw new Error("Generated biography was too short");
    assertPublicBioIsPrivate(biography, musician);

    await musicianModel.updateOne(
      { _id: musician._id },
      {
        $set: {
          tscApprovedBio: biography,
          approvedBioSource: "ai",
          aiBioReviewRequired: true,
          aiBioGeneratedAt: new Date(),
          aiBioReviewedAt: null,
          aiBioSourceHash: sourceHash,
          aiBioModel: model,
          aiBioGenerationError: "",
        },
      },
      { runValidators: false },
    );

    return { generated: true, biography, model };
  } catch (error) {
    const generationError = String(error?.message || "Biography generation failed").slice(0, 500);
    await musicianModel.updateOne(
      { _id: musician._id },
      { $set: { aiBioGenerationError: generationError } },
      { runValidators: false },
    );
    console.error("❌ AI musician bio generation failed:", error);
    return { generated: false, reason: "generation_failed", error: generationError };
  }
};
