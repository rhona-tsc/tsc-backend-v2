import mongoose from "mongoose";
import crypto from "crypto";
import actModel from "../models/actModel.js";
import musicianModel from "../models/musicianModel.js";
import { canModerateOriginals } from "../services/originalsPolicyService.js";
import actMemberDetailsRequestModel from "../models/actMemberDetailsRequestModel.js";

const clean = (value) => String(value || "").trim();
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
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
const publicSiteBase = () => String(process.env.PUBLIC_SITE_URL || process.env.FRONTEND_URL || "https://admin.thesupremecollective.co.uk").replace(/\/$/, "");

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
    const safeActs = acts.map((act) => ({
      _id: act._id,
      name: act.tscName || act.name || "Unnamed act",
      status: act.status,
      lineups: (act.lineups || []).map((lineup) => ({
        _id: lineup._id,
        lineupId: lineup.lineupId,
        actSize: lineup.actSize || "Lineup",
        roles: (lineup.bandMembers || []).filter((member) => clean(member.instrument)).map((member) => ({
          memberId: member._id,
          role: member.instrument,
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
          })),
          detailsRequest: requestByMember.get(`${act._id}:${lineup._id}:${member._id}`) || null,
        })),
      })),
    }));
    return res.json({ success: true, acts: safeActs });
  } catch (error) {
    console.error("❌ listRegularDeputies error:", error);
    return res.status(500).json({ success: false, message: "Failed to load regular deputies" });
  }
};

export const searchRegularDeputyMusicians = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const query = clean(req.query?.q);
    const genre = clean(req.query?.genre);
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
      .select("firstName lastName email basicInfo instrumentation other_skills vocals.genres genres profilePhoto")
      .lean();
    const safeMusicians = musicians.map((musician) => {
      const genres = Array.from(new Set([
        ...(musician.vocals?.genres || []),
        ...(musician.genres || []),
      ].map(clean).filter(Boolean)));
      return {
        musician,
        genres,
        genreMatch: Boolean(genre && genres.some((item) => genrePattern.test(item))),
      };
    }).sort((a, b) => {
      if (a.genreMatch !== b.genreMatch) return a.genreMatch ? -1 : 1;
      const aName = clean(a.musician.firstName || a.musician.basicInfo?.firstName);
      const bName = clean(b.musician.firstName || b.musician.basicInfo?.firstName);
      return aName.localeCompare(bName, "en", { sensitivity: "base" });
    });
    return res.json({
      success: true,
      musicians: safeMusicians.map(({ musician, genres, genreMatch }) => ({
        _id: musician._id,
        name: [musician.firstName || musician.basicInfo?.firstName, musician.lastName || musician.basicInfo?.lastName].filter(Boolean).join(" "),
        email: musician.email || musician.basicInfo?.email || "",
        instruments: Array.from(new Set([
          ...(musician.instrumentation || []).map((item) => item.instrument),
          ...(musician.other_skills || []),
        ].map(clean).filter(Boolean))),
        genres,
        genreMatch,
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
      detailsRequest = {
        _id: request._id,
        state: request.state,
        emailDeliveryState: request.emailDeliveryState,
        expiresAt: request.expiresAt,
        formUrl: `${publicSiteBase()}/regular-deputies/details/${rawToken}`,
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
