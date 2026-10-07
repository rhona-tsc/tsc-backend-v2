import mongoose from "mongoose";
import crypto from "crypto";
import actModel from "../models/actModel.js";
import musicianModel from "../models/musicianModel.js";
import { canModerateOriginals } from "../services/originalsPolicyService.js";
import actMemberDetailsRequestModel from "../models/actMemberDetailsRequestModel.js";
import sendEmail from "../utils/sendEmail.js";

const clean = (value) => String(value || "").trim();
const normalise = (value) => clean(value).toLowerCase();
const validId = (value) => mongoose.Types.ObjectId.isValid(clean(value));
const requireAdmin = (req, res) => {
  if (canModerateOriginals(req.user)) return true;
  res.status(403).json({ success: false, message: "Admin access required" });
  return false;
};
const musicianSnapshot = (musician) => ({
  musicianId: String(musician._id),
  firstName: clean(musician.firstName || musician.basicInfo?.firstName),
  lastName: clean(musician.lastName || musician.basicInfo?.lastName),
  email: clean(musician.email || musician.basicInfo?.email).toLowerCase(),
  phoneNumber: clean(musician.phone || musician.basicInfo?.phone),
  image: clean(musician.profilePhoto),
});
const deputyId = (deputy) => clean(
  deputy?.musicianId || deputy?._id || deputy?.id || deputy?.clientKey,
);
const copyDeputySnapshot = (deputy) => ({
  id: clean(deputy?.id || deputy?._id),
  musicianId: clean(deputy?.musicianId),
  clientKey: clean(deputy?.clientKey),
  firstName: clean(deputy?.firstName),
  lastName: clean(deputy?.lastName),
  email: clean(deputy?.email).toLowerCase(),
  phoneNumber: clean(deputy?.phoneNumber),
  image: clean(deputy?.image),
});
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
const publicSiteBase = () => String(process.env.PUBLIC_SITE_URL || process.env.FRONTEND_URL || "https://admin.thesupremecollective.co.uk").replace(/\/$/, "");
const escapeHtml = (value) => clean(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");
const deputyInviteEmail = ({ recipientName, actName, roleName, setupUrl }) => ({
  subject: `Invitation to join ${actName} as a regular deputy`,
  text: [
    `Hi ${recipientName},`,
    "",
    `You have been invited to join ${actName} as a regular deputy ${roleName}.`,
    "Create your secure Supreme Collective login and complete your musician profile using the link below:",
    "",
    setupUrl,
    "",
    "This link expires in 24 hours.",
    "",
    "Best wishes,",
    "The Supreme Collective",
  ].join("\n"),
  html: `
    <p>Hi ${escapeHtml(recipientName)},</p>
    <p>You have been invited to join <strong>${escapeHtml(actName)}</strong> as a regular deputy <strong>${escapeHtml(roleName)}</strong>.</p>
    <p>Create your secure Supreme Collective login and complete your musician profile using the button below.</p>
    <p><a href="${escapeHtml(setupUrl)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#ff6667;color:#fff;text-decoration:none;font-weight:700;">Accept invitation and create my profile</a></p>
    <p style="color:#666;font-size:13px;">This secure link expires in 24 hours.</p>
    <p>Best wishes,<br />The Supreme Collective</p>
  `,
});

const findActRole = async ({ actId, lineupId, memberId }) => {
  if (![actId, lineupId, memberId].every(validId)) return {};
  const act = await actModel.findById(actId);
  const lineup = act?.lineups?.id(lineupId);
  const member = lineup?.bandMembers?.id(memberId);
  return { act, lineup, member };
};

const getProfileSkills = (musician) => [
  ...(musician.instrumentation || []).map((item) => item?.instrument || item),
  ...(musician.other_skills || []),
  ...(musician.vocals?.type || []),
].map(normalise).filter(Boolean);

const profileMeetsRequirement = (musician, requirement) => {
  const wanted = normalise(requirement);
  const skills = getProfileSkills(musician);
  const hasSkill = (pattern) => skills.some((skill) => pattern.test(skill));

  if (/sound engineer|sound engineering/.test(wanted)) {
    return musician.capabilities?.soundEngineering === true ||
      musician.capabilities?.paProvision === true ||
      hasSkill(/sound engineer|sound engineering|audio engineer|\bfoh\b|front of house|\bpa\b|pa provision/);
  }
  if (/pa.*light|light.*pa/.test(wanted)) {
    const hasPa = musician.capabilities?.paProvision === true || hasSkill(/\bpa\b|pa provision/);
    const hasLights = musician.capabilities?.lightingProvision === true || hasSkill(/light provision|lights provision|pa.*lights/);
    return hasPa && hasLights;
  }
  if (/\bpa\b|pa provision/.test(wanted)) {
    return musician.capabilities?.paProvision === true || hasSkill(/\bpa\b|pa provision|sound engineering with pa/);
  }
  if (/light/.test(wanted)) {
    return musician.capabilities?.lightingProvision === true || hasSkill(/light provision|lights provision/);
  }
  if (/backing.*voc|\bbv\b/.test(wanted)) {
    return hasSkill(/backing.*voc|\bbv\b|lead.*voc|vocalist|singer/);
  }
  if (/musical direct|band leader|\bmd\b/.test(wanted)) {
    return hasSkill(/musical direct|band leader|\bmd\b/);
  }

  return skills.some((skill) => skill.includes(wanted) || wanted.includes(skill));
};

export const listRegularDeputies = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const acts = await actModel.find({ status: { $nin: ["draft", "trashed"] } })
      .select("name tscName status lineups._id lineups.lineupId lineups.actSize lineups.bandMembers")
      .sort({ tscName: 1, name: 1 }).lean();
    const openRequests = await actMemberDetailsRequestModel.find({
      actId: { $in: acts.map((act) => act._id) },
      state: "queued",
      expiresAt: { $gt: new Date() },
    }).select("actId lineupId memberId state emailDeliveryState expiresAt").lean();
    const requestByMember = new Map(openRequests.map((request) => [`${request.actId}:${request.lineupId}:${request.memberId}`, request]));
    const deputyMusicianIds = Array.from(new Set(
      acts.flatMap((act) => (act.lineups || []).flatMap((lineup) =>
        (lineup.bandMembers || []).flatMap((member) =>
          (member.deputies || []).map(deputyId).filter(validId),
        ),
      )),
    ));
    const deputyAccounts = await musicianModel.find({ _id: { $in: deputyMusicianIds } })
      .select("_id hasSetPassword onboardingStatus")
      .lean();
    const deputyAccountById = new Map(
      deputyAccounts.map((musician) => [String(musician._id), musician]),
    );
    const safeActs = acts.map((act) => ({
      _id: act._id,
      name: act.tscName || act.name || "Unnamed act",
      status: act.status,
      lineups: (act.lineups || []).map((lineup) => ({
        _id: lineup._id,
        lineupId: lineup.lineupId,
        actSize: lineup.actSize || "Lineup",
        roles: (lineup.bandMembers || []).filter((member) => clean(member.instrument)).map((member) => {
          const essentialAdditionalRoles = (member.additionalRoles || [])
            .filter((additionalRole) => additionalRole?.isEssential && clean(additionalRole?.role))
            .map((additionalRole) => clean(additionalRole.role))
            .filter((additionalRole) => additionalRole.toLowerCase() !== clean(member.instrument).toLowerCase());
          const roleLabel = Array.from(new Set([
            clean(member.instrument),
            ...essentialAdditionalRoles,
          ])).join(" & ");

          return {
          memberId: member._id,
          role: member.instrument,
          roleLabel,
          essentialAdditionalRoles,
          primary: {
            musicianId: member.musicianId || "",
            firstName: member.firstName || "",
            lastName: member.lastName || "",
            image: member.musicianProfileImageUpload || "",
          },
          deputies: (member.deputies || []).map((deputy) => ({
            id: deputy._id || deputy.id || deputy.clientKey,
            musicianId: deputy.musicianId || deputy._id || deputy.id || "",
            firstName: deputy.firstName || "",
            lastName: deputy.lastName || "",
            image: deputy.image || "",
            invitePending:
              deputyAccountById.has(deputyId(deputy)) &&
              deputyAccountById.get(deputyId(deputy))?.hasSetPassword !== true,
          })),
          detailsRequest: requestByMember.get(`${act._id}:${lineup._id}:${member._id}`) || null,
        };
        }),
      })),
    }));
    return res.json({ success: true, acts: safeActs });
  } catch (error) {
    console.error("❌ listRegularDeputies error:", error);
    return res.status(500).json({ success: false, message: "Failed to load regular deputies" });
  }
};

export const inviteRegularDeputy = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { actId, lineupId, memberId } = req.params;
    if (![actId, lineupId, memberId].every(validId)) {
      return res.status(400).json({ success: false, message: "Invalid act role" });
    }
    const firstName = clean(req.body?.firstName);
    const lastName = clean(req.body?.lastName);
    const email = clean(req.body?.email).toLowerCase();
    if (!firstName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "Enter their first name and a valid email address" });
    }

    const { act, lineup, member } = await findActRole({ actId, lineupId, memberId });
    if (!act || !lineup || !member) {
      return res.status(404).json({ success: false, message: "Act role not found" });
    }

    let musician = await musicianModel.findOne({ email });
    if (musician?.hasSetPassword) {
      return res.status(409).json({
        success: false,
        message: "This email already belongs to a registered musician. Add them using the musician search instead.",
      });
    }
    if (!musician) {
      musician = await musicianModel.create({
        firstName,
        lastName,
        email,
        basicInfo: { firstName, lastName, email },
        role: "musician",
        onboardingStatus: "invited",
      });
    } else {
      musician.firstName = musician.firstName || firstName;
      musician.lastName = musician.lastName || lastName;
      musician.basicInfo = {
        ...(musician.basicInfo?.toObject?.() || musician.basicInfo || {}),
        firstName: musician.basicInfo?.firstName || firstName,
        lastName: musician.basicInfo?.lastName || lastName,
        email,
      };
    }

    const musicianId = String(musician._id);
    if (clean(member.musicianId) === musicianId) {
      return res.status(409).json({ success: false, message: "This musician is already the original member" });
    }
    const alreadyAdded = (member.deputies || []).some(
      (deputy) => deputyId(deputy) === musicianId,
    );
    if (!alreadyAdded) member.deputies.push(musicianSnapshot(musician));

    const rawToken = crypto.randomBytes(32).toString("hex");
    const now = new Date();
    musician.inviteTokenHash = hashToken(rawToken);
    musician.inviteTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    musician.mustChangePassword = true;
    musician.onboardingInvitedAt = musician.onboardingInvitedAt || now;
    musician.onboardingStatus = "invited";
    musician.lastInviteSentAt = now;
    musician.inviteCount = Number(musician.inviteCount || 0) + 1;
    await musician.save();
    act.markModified("lineups");
    await act.save();

    const setupBase = String(
      process.env.ADMIN_FRONTEND_URL || "https://admin.thesupremecollective.co.uk",
    ).replace(/\/$/, "");
    const setupUrl = `${setupBase}/set-password?token=${rawToken}&email=${encodeURIComponent(email)}`;
    const actName = act.tscName || act.name || "a Supreme Collective act";
    const roleName = member.instrument || "musician";
    const recipientName = [firstName, lastName].filter(Boolean).join(" ");
    const invitation = deputyInviteEmail({ recipientName, actName, roleName, setupUrl });
    const emailResult = await sendEmail({
      to: email,
      bcc: "hello@thesupremecollective.co.uk",
      ...invitation,
    });

    return res.status(201).json({
      success: true,
      message: alreadyAdded ? "Invitation resent" : "Deputy invited",
      emailSent: emailResult?.ok !== false,
      musicianId,
    });
  } catch (error) {
    console.error("❌ inviteRegularDeputy error:", error);
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: "A musician with this email already exists" });
    }
    return res.status(500).json({ success: false, message: "Failed to invite deputy" });
  }
};

export const previewRegularDeputyInvite = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { actId, lineupId, memberId } = req.params;
    const firstName = clean(req.body?.firstName);
    const lastName = clean(req.body?.lastName);
    const email = clean(req.body?.email).toLowerCase();
    if (!firstName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "Enter their first name and a valid email address" });
    }
    const { act, lineup, member } = await findActRole({ actId, lineupId, memberId });
    if (!act || !lineup || !member) {
      return res.status(404).json({ success: false, message: "Act role not found" });
    }
    const actName = act.tscName || act.name || "a Supreme Collective act";
    const roleName = member.instrument || "musician";
    const recipientName = [firstName, lastName].filter(Boolean).join(" ");
    const setupUrl = `${String(process.env.ADMIN_FRONTEND_URL || "https://admin.thesupremecollective.co.uk").replace(/\/$/, "")}/set-password?token=TEST-PREVIEW-LINK&email=${encodeURIComponent(email)}`;
    const result = await sendEmail({
      to: email,
      testMode: true,
      forceTo: "hello@thesupremecollective.co.uk",
      ...deputyInviteEmail({ recipientName, actName, roleName, setupUrl }),
    });
    if (result?.ok === false) {
      return res.status(502).json({ success: false, message: "The test email could not be delivered. Please check the email service settings." });
    }
    return res.json({ success: true, message: "Test invitation sent to hello@thesupremecollective.co.uk" });
  } catch (error) {
    console.error("❌ previewRegularDeputyInvite error:", error);
    return res.status(500).json({ success: false, message: "Could not send the test invitation. Please try again." });
  }
};

export const searchRegularDeputyMusicians = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const query = clean(req.query?.q);
    const genre = clean(req.query?.genre);
    let requirements = [];
    try {
      const parsed = JSON.parse(clean(req.query?.requirements) || "[]");
      requirements = Array.isArray(parsed) ? parsed.map(clean).filter(Boolean) : [];
    } catch {
      requirements = [];
    }
    if (query.length < 2 && !genre) return res.json({ success: true, musicians: [] });
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(escaped, "i");
    const textMatch = query.length >= 2 ? {
      $or: [
        { firstName: pattern }, { lastName: pattern }, { email: pattern },
        { "basicInfo.firstName": pattern }, { "basicInfo.lastName": pattern },
        { "instrumentation.instrument": pattern },
        { other_skills: pattern },
      ],
    } : null;
    const escapedGenre = genre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const genrePattern = new RegExp(`^${escapedGenre}$`, "i");
    const musicians = await musicianModel.find({
      $and: [textMatch].filter(Boolean),
    })
      .select("firstName lastName email basicInfo musicianSlug instrumentation other_skills vocals genres capabilities profilePhoto")
      .lean();
    const safeMusicians = musicians.map((musician) => {
      const genres = Array.from(new Set([
        ...(musician.vocals?.genres || []),
        ...(musician.genres || []),
      ].map(clean).filter(Boolean)));
      const matchedRequirements = requirements.filter((requirement) =>
        profileMeetsRequirement(musician, requirement),
      );
      const missingRequirements = requirements.filter(
        (requirement) => !matchedRequirements.includes(requirement),
      );
      return {
        musician,
        genres,
        genreMatch: Boolean(genre && genres.some((item) => genrePattern.test(item))),
        matchedRequirements,
        missingRequirements,
        requirementsMatch: Boolean(requirements.length && !missingRequirements.length),
      };
    }).sort((a, b) => {
      if (a.requirementsMatch !== b.requirementsMatch) return a.requirementsMatch ? -1 : 1;
      if (a.matchedRequirements.length !== b.matchedRequirements.length) {
        return b.matchedRequirements.length - a.matchedRequirements.length;
      }
      if (a.genreMatch !== b.genreMatch) return a.genreMatch ? -1 : 1;
      const aName = clean(a.musician.firstName || a.musician.basicInfo?.firstName);
      const bName = clean(b.musician.firstName || b.musician.basicInfo?.firstName);
      return aName.localeCompare(bName, "en", { sensitivity: "base" });
    });
    return res.json({
      success: true,
      musicians: safeMusicians.map(({ musician, genres, genreMatch, matchedRequirements, missingRequirements, requirementsMatch }) => ({
        _id: musician._id,
        musicianSlug: musician.musicianSlug || "",
        name: [musician.firstName || musician.basicInfo?.firstName, musician.lastName || musician.basicInfo?.lastName].filter(Boolean).join(" "),
        email: musician.email || musician.basicInfo?.email || "",
        instruments: Array.from(new Set([
          ...(musician.instrumentation || []).map((item) => item.instrument),
          ...(musician.other_skills || []),
        ].map(clean).filter(Boolean))),
        genres,
        genreMatch,
        matchedRequirements,
        missingRequirements,
        requirementsMatch,
        image: musician.profilePhoto || "",
      })),
    });
  } catch (error) {
    console.error("❌ searchRegularDeputyMusicians error:", error);
    return res.status(500).json({ success: false, message: "Failed to search musicians" });
  }
};

export const updateRegularDeputyRole = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { actId, lineupId, memberId } = req.params;
    if (![actId, lineupId, memberId].every(validId)) return res.status(400).json({ success: false, message: "Invalid act role" });
    const action = clean(req.body?.action);
    const musicianId = clean(req.body?.musicianId);
    if (!["replace_primary", "add_deputy", "remove_deputy", "reorder_deputies"].includes(action)) return res.status(400).json({ success: false, message: "Invalid update action" });
    const act = await actModel.findById(actId);
    const lineup = act?.lineups?.id(lineupId);
    const member = lineup?.bandMembers?.id(memberId);
    if (!act || !lineup || !member) return res.status(404).json({ success: false, message: "Act role not found" });

    let selectedMusician = null;
    if (action === "reorder_deputies") {
      const requestedOrder = Array.isArray(req.body?.musicianIds)
        ? req.body.musicianIds.map(clean).filter(Boolean)
        : [];
      const currentDeputies = member.deputies || [];
      const deputyId = (deputy) => clean(
        deputy.musicianId || deputy._id || deputy.id || deputy.clientKey,
      );
      const currentIds = currentDeputies.map(deputyId);
      const isExactOrder =
        requestedOrder.length === currentIds.length &&
        new Set(requestedOrder).size === requestedOrder.length &&
        currentIds.every((id) => requestedOrder.includes(id));

      if (!isExactOrder) {
        return res.status(400).json({
          success: false,
          message: "Deputy order is out of date. Refresh and try again.",
        });
      }

      const deputyById = new Map(currentDeputies.map((deputy) => [deputyId(deputy), deputy]));
      member.deputies = requestedOrder.map((id) => deputyById.get(id));
    } else if (action === "remove_deputy") {
      member.deputies = (member.deputies || []).filter((deputy) =>
        ![deputy.musicianId, deputy._id, deputy.id, deputy.clientKey].some((value) => clean(value) === musicianId),
      );
    } else {
      if (!validId(musicianId)) return res.status(400).json({ success: false, message: "Choose a musician" });
      selectedMusician = await musicianModel.findById(musicianId).lean();
      if (!selectedMusician) return res.status(404).json({ success: false, message: "Musician not found" });
      const snapshot = musicianSnapshot(selectedMusician);
      if (action === "replace_primary") {
        member.musicianId = snapshot.musicianId;
        member.firstName = snapshot.firstName;
        member.lastName = snapshot.lastName;
        member.email = snapshot.email;
        member.phoneNumber = snapshot.phoneNumber;
        member.musicianProfileImageUpload = snapshot.image;
        member.whatsappOptIn = Boolean(selectedMusician.whatsappOptIn);
        member.deputies = (member.deputies || []).filter((deputy) => clean(deputy.musicianId || deputy._id || deputy.id) !== musicianId);
      } else {
        if (clean(member.musicianId) === musicianId) return res.status(409).json({ success: false, message: "This musician is already the primary" });
        const exists = (member.deputies || []).some((deputy) => clean(deputy.musicianId || deputy._id || deputy.id) === musicianId);
        if (!exists) member.deputies.push(snapshot);
      }
    }
    let detailsRequest = null;
    if (action === "replace_primary") {
      member.sortCode = "";
      member.accountNumber = "";
      member.accountName = "";
      member.dietaryRequirements = "";
      member.postCode = clean(selectedMusician.address?.postcode);
      member.carRegistration = "";
      member.carRegistrationValue = "";
      member.canDJ = false;
      member.haveMixingConsoleOrDecks = false;
      member.hasDjTable = false;
      member.haveBooth = false;
      member.wireless = false;
      member.haveSoloPa = false;
      member.haveDuoPa = false;
      member.inPromo = false;
      act.markModified("lineups");
      await act.save();

      await actMemberDetailsRequestModel.updateMany(
        { actId: act._id, lineupId: lineup._id, memberId: member._id, state: "queued" },
        { $set: { state: "cancelled" } },
      );
      const rawToken = crypto.randomBytes(32).toString("hex");
      const request = await actMemberDetailsRequestModel.create({
        tokenHash: hashToken(rawToken),
        actId: act._id,
        lineupId: lineup._id,
        memberId: member._id,
        musicianId,
        roleName: member.instrument,
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        emailDeliveryState: "queued",
      });
      const formUrl = `${publicSiteBase()}/regular-deputies/details/${rawToken}`;
      const recipientName = [snapshot.firstName, snapshot.lastName].filter(Boolean).join(" ") || "there";
      const actName = act.tscName || act.name || "your act";
      const emailResult = await sendEmail({
        to: snapshot.email,
        bcc: "hello@thesupremecollective.co.uk",
        subject: `Please confirm your details for ${actName}`,
        text: [
          `Hi ${recipientName},`,
          "",
          `You have been listed as the original ${member.instrument || "musician"} for ${actName}.`,
          "Please use the secure link below to confirm the details we need for future bookings and payments:",
          "",
          formUrl,
          "",
          "This link expires in 14 days.",
          "",
          "Best wishes,",
          "The Supreme Collective",
        ].join("\n"),
        html: `
          <p>Hi ${escapeHtml(recipientName)},</p>
          <p>You have been listed as the original <strong>${escapeHtml(member.instrument || "musician")}</strong> for <strong>${escapeHtml(actName)}</strong>.</p>
          <p>Please use the secure link below to confirm the details we need for future bookings and payments.</p>
          <p><a href="${escapeHtml(formUrl)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#111;color:#fff;text-decoration:none;font-weight:600;">Confirm my details</a></p>
          <p style="color:#666;font-size:13px;">This secure link expires in 14 days.</p>
          <p>Best wishes,<br />The Supreme Collective</p>
        `,
      });
      request.emailDeliveryState = emailResult?.ok ? "sent" : "failed";
      await request.save();
      detailsRequest = {
        _id: request._id,
        state: request.state,
        emailDeliveryState: request.emailDeliveryState,
        expiresAt: request.expiresAt,
        formUrl,
      };
    } else {
      act.markModified("lineups");
      await act.save();
    }
    return res.json({ success: true, message: "Regular deputies updated", detailsRequest });
  } catch (error) {
    console.error("❌ updateRegularDeputyRole error:", error);
    return res.status(500).json({ success: false, message: "Failed to update regular deputies" });
  }
};

export const copyFirstLineupDeputies = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { actId } = req.params;
    if (!validId(actId)) return res.status(400).json({ success: false, message: "Invalid act" });
    const act = await actModel.findById(actId);
    if (!act) return res.status(404).json({ success: false, message: "Act not found" });
    if (!Array.isArray(act.lineups) || act.lineups.length < 2) {
      return res.status(400).json({ success: false, message: "This act does not have any additional lineups" });
    }

    const sourceMembers = (act.lineups[0].bandMembers || []).filter((member) => clean(member.instrument));
    let rolesMatched = 0;
    let deputiesAdded = 0;
    for (const targetLineup of act.lineups.slice(1)) {
      const usedSourceIndexes = new Set();
      for (const targetMember of targetLineup.bandMembers || []) {
        const primaryId = clean(targetMember.musicianId);
        const instrument = normalise(targetMember.instrument);
        let sourceIndex = sourceMembers.findIndex((member, index) =>
          !usedSourceIndexes.has(index) && primaryId && clean(member.musicianId) === primaryId,
        );
        if (sourceIndex < 0) {
          sourceIndex = sourceMembers.findIndex((member, index) =>
            !usedSourceIndexes.has(index) && instrument && normalise(member.instrument) === instrument,
          );
        }
        if (sourceIndex < 0) continue;

        usedSourceIndexes.add(sourceIndex);
        rolesMatched += 1;
        const sourceDeputies = sourceMembers[sourceIndex].deputies || [];
        const existingDeputies = targetMember.deputies || [];
        const sourceIds = new Set(sourceDeputies.map(deputyId).filter(Boolean));
        const existingIds = new Set(existingDeputies.map(deputyId).filter(Boolean));
        deputiesAdded += [...sourceIds].filter((id) => !existingIds.has(id)).length;
        targetMember.deputies = [
          ...sourceDeputies.map(copyDeputySnapshot),
          ...existingDeputies
            .filter((deputy) => !sourceIds.has(deputyId(deputy)))
            .map(copyDeputySnapshot),
        ];
      }
    }

    act.markModified("lineups");
    await act.save();
    return res.json({ success: true, message: "First lineup deputies copied", rolesMatched, deputiesAdded });
  } catch (error) {
    console.error("❌ copyFirstLineupDeputies error:", error);
    return res.status(500).json({ success: false, message: "Failed to copy first lineup deputies" });
  }
};

export const copyDeputiesFromAct = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { actId } = req.params;
    const sourceActId = clean(req.body?.sourceActId);
    const sourceLineupId = clean(req.body?.sourceLineupId);
    const targetLineupId = clean(req.body?.targetLineupId);
    const applyToAllLineups = req.body?.applyToAllLineups !== false;

    if (![actId, sourceActId, sourceLineupId].every(validId)) {
      return res.status(400).json({ success: false, message: "Choose a source act and lineup" });
    }
    if (String(actId) === sourceActId) {
      return res.status(400).json({ success: false, message: "Choose a different source act" });
    }
    if (!applyToAllLineups && !validId(targetLineupId)) {
      return res.status(400).json({ success: false, message: "Choose a destination lineup" });
    }

    const [targetAct, sourceAct] = await Promise.all([
      actModel.findById(actId),
      actModel.findById(sourceActId),
    ]);
    if (!targetAct || !sourceAct) {
      return res.status(404).json({ success: false, message: "Act not found" });
    }

    const sourceLineup = sourceAct.lineups?.id(sourceLineupId);
    if (!sourceLineup) {
      return res.status(404).json({ success: false, message: "Source lineup not found" });
    }
    const targetLineups = applyToAllLineups
      ? Array.from(targetAct.lineups || [])
      : [targetAct.lineups?.id(targetLineupId)].filter(Boolean);
    if (!targetLineups.length) {
      return res.status(404).json({ success: false, message: "Destination lineup not found" });
    }

    const sourceMembers = (sourceLineup.bandMembers || []).filter((member) =>
      clean(member.instrument),
    );
    let rolesMatched = 0;
    let deputiesAdded = 0;

    for (const targetLineup of targetLineups) {
      const usedSourceIndexes = new Set();
      for (const targetMember of targetLineup.bandMembers || []) {
        const targetPrimaryId = clean(targetMember.musicianId);
        const targetInstrument = normalise(targetMember.instrument);
        let sourceIndex = sourceMembers.findIndex(
          (member, index) =>
            !usedSourceIndexes.has(index) &&
            targetPrimaryId &&
            clean(member.musicianId) === targetPrimaryId,
        );
        if (sourceIndex < 0) {
          sourceIndex = sourceMembers.findIndex(
            (member, index) =>
              !usedSourceIndexes.has(index) &&
              targetInstrument &&
              normalise(member.instrument) === targetInstrument,
          );
        }
        if (sourceIndex < 0) continue;

        usedSourceIndexes.add(sourceIndex);
        rolesMatched += 1;
        const sourceDeputies = (sourceMembers[sourceIndex].deputies || []).filter(
          (deputy) => deputyId(deputy) && deputyId(deputy) !== targetPrimaryId,
        );
        const existingDeputies = targetMember.deputies || [];
        const sourceIds = new Set(sourceDeputies.map(deputyId));
        const existingIds = new Set(existingDeputies.map(deputyId).filter(Boolean));
        deputiesAdded += [...sourceIds].filter((id) => !existingIds.has(id)).length;
        targetMember.deputies = [
          ...sourceDeputies.map(copyDeputySnapshot),
          ...existingDeputies
            .filter((deputy) => !sourceIds.has(deputyId(deputy)))
            .map(copyDeputySnapshot),
        ];
      }
    }

    targetAct.markModified("lineups");
    await targetAct.save();
    return res.json({
      success: true,
      message: "Regular deputies copied from source act",
      rolesMatched,
      deputiesAdded,
      lineupsUpdated: targetLineups.length,
    });
  } catch (error) {
    console.error("❌ copyDeputiesFromAct error:", error);
    return res.status(500).json({ success: false, message: "Failed to copy deputies from source act" });
  }
};

export const getActMemberDetailsRequest = async (req, res) => {
  try {
    const request = await actMemberDetailsRequestModel.findOne({ tokenHash: hashToken(req.params.token), state: "queued" }).lean();
    if (!request || request.expiresAt <= new Date()) return res.status(404).json({ success: false, message: "This secure details link is invalid or has expired" });
    const [act, musician] = await Promise.all([
      actModel.findById(request.actId).select("name tscName").lean(),
      musicianModel.findById(request.musicianId).select("firstName lastName basicInfo address").lean(),
    ]);
    return res.json({ success: true, request: { actName: act?.tscName || act?.name || "the act", roleName: request.roleName, musicianName: [musician?.firstName || musician?.basicInfo?.firstName, musician?.lastName || musician?.basicInfo?.lastName].filter(Boolean).join(" "), address: musician?.address || {}, expiresAt: request.expiresAt } });
  } catch (error) {
    console.error("❌ getActMemberDetailsRequest error:", error);
    return res.status(500).json({ success: false, message: "Failed to open secure details request" });
  }
};

export const submitActMemberDetailsRequest = async (req, res) => {
  try {
    const request = await actMemberDetailsRequestModel.findOne({ tokenHash: hashToken(req.params.token), state: "queued" });
    if (!request || request.expiresAt <= new Date()) return res.status(404).json({ success: false, message: "This secure details link is invalid or has expired" });
    const act = await actModel.findById(request.actId);
    const musician = await musicianModel.findById(request.musicianId);
    const member = act?.lineups?.id(request.lineupId)?.bandMembers?.id(request.memberId);
    if (!act || !musician || !member || clean(member.musicianId) !== String(request.musicianId)) return res.status(409).json({ success: false, message: "This act role has changed; please contact TSC" });
    const address = req.body?.address || {};
    const sortCode = clean(req.body?.sortCode).replace(/\D/g, "");
    const accountNumber = clean(req.body?.accountNumber).replace(/\D/g, "");
    if (!clean(address.line1) || !clean(address.town) || !clean(address.postcode)) return res.status(400).json({ success: false, message: "Address line, town and postcode are required" });
    if (sortCode.length !== 6 || accountNumber.length !== 8 || !clean(req.body?.accountName)) return res.status(400).json({ success: false, message: "Enter a valid account name, 6-digit sort code and 8-digit account number" });
    musician.address = {
      line1: clean(address.line1), line2: clean(address.line2), town: clean(address.town),
      county: clean(address.county), postcode: clean(address.postcode), country: clean(address.country || "United Kingdom"),
    };
    member.postCode = clean(address.postcode);
    member.dietaryRequirements = clean(req.body?.dietaryRequirements);
    member.carRegistration = clean(req.body?.carRegistration);
    member.carRegistrationValue = clean(req.body?.carRegistration);
    member.accountName = clean(req.body?.accountName);
    member.accountNumber = accountNumber;
    member.sortCode = sortCode;
    member.canDJ = req.body?.canDJ === true;
    member.haveMixingConsoleOrDecks = req.body?.haveMixingConsoleOrDecks === true;
    member.hasDjTable = req.body?.hasDjTable === true;
    member.haveBooth = req.body?.haveBooth === true;
    member.wireless = req.body?.wireless === true;
    member.haveSoloPa = req.body?.haveSoloPa === true;
    member.haveDuoPa = req.body?.haveDuoPa === true;
    act.markModified("lineups");
    await Promise.all([act.save(), musician.save()]);
    request.state = "completed";
    request.completedAt = new Date();
    await request.save();
    return res.json({ success: true, message: "Thank you — your details have been securely updated" });
  } catch (error) {
    console.error("❌ submitActMemberDetailsRequest error:", error);
    return res.status(500).json({ success: false, message: "Failed to save your details" });
  }
};
