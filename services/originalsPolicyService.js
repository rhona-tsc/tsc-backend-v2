const normalise = (value) => String(value || "").trim().toLowerCase();

export const ORIGINALS_OWNER_AGREEMENT_VERSION =
  "originals-owner-v0.1-legal-review";

export const isOriginalsEnabled = (env = process.env) =>
  normalise(env.ORIGINALS_ENABLED) === "true";

export const getOriginalsUserId = (user = {}) =>
  String(user?._id || user?.id || user?.userId || "").trim();

export const canModerateOriginals = (user = {}) => {
  const role = normalise(user?.role || user?.userrole);
  const email = normalise(user?.email || user?.useremail);
  return (
    ["admin", "superadmin", "tsc_admin", "agent"].includes(role) ||
    email === "hello@thesupremecollective.co.uk"
  );
};

const ORIGINALS_PREVIEW_USER_IDS = new Set(["693ac400ef2c3100595c0ed8"]);
const ORIGINALS_PREVIEW_EMAILS = new Set(["hello@thesupremecollective.co.uk"]);

export const canAccessOriginalsPreview = (user = {}) => {
  const userId = getOriginalsUserId(user);
  const email = normalise(user?.email || user?.useremail);
  return ORIGINALS_PREVIEW_USER_IDS.has(userId) || ORIGINALS_PREVIEW_EMAILS.has(email);
};

export const getReservationExpiry = (from = new Date(), extensionHours = 0) =>
  new Date(new Date(from).getTime() + (24 + Number(extensionHours || 0)) * 60 * 60 * 1000);

export const canRequestReservationExtension = (reservation = {}) =>
  reservation.state === "active" &&
  Number(reservation.extensionCount || 0) < 3 &&
  !reservation.extensionRequest?.status;

export const getDueReservationReminder = (reservation = {}, now = new Date()) => {
  if (reservation.state !== "active" || !reservation.expiresAt) return "";
  const hoursLeft = (new Date(reservation.expiresAt).getTime() - new Date(now).getTime()) / 3600000;
  if (hoursLeft <= 0) return "";
  if (hoursLeft <= 1) return reservation.remindersSent?.oneHour ? "" : "oneHour";
  if (hoursLeft <= 6) return reservation.remindersSent?.sixHour ? "" : "sixHour";
  if (hoursLeft <= 12) return reservation.remindersSent?.twelveHour ? "" : "twelveHour";
  return "";
};

export const normaliseStringList = (value, { maxItems = 30 } = {}) => {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  ].slice(0, maxItems);
};

export const normaliseRequestedRoles = (value) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const roles = [];

  value.forEach((item) => {
    const name = String(item?.name || item || "").trim();
    const key = normalise(name);
    if (!name || seen.has(key)) return;
    seen.add(key);
    roles.push({
      name,
      order: roles.length,
      foundationEligible: Boolean(item?.foundationEligible),
    });
  });

  return roles.slice(0, 30);
};

export const validateOriginalProjectForModeration = (project = {}) => {
  const errors = [];
  if (!String(project.title || "").trim()) errors.push("Project title is required");
  if (!String(project.description || "").trim()) errors.push("Project description is required");
  if (!Array.isArray(project.genres) || !project.genres.length) {
    errors.push("At least one genre is required");
  }
  if (!Array.isArray(project.requestedRoles) || !project.requestedRoles.length) {
    errors.push("At least one requested role is required");
  }
  if (project.ownerAnonymous && !String(project.ownerCreditName || "").trim()) {
    errors.push("An artistic or credit name is required for an anonymous owner");
  }
  if (
    project.hasInitialStem &&
    (!Array.isArray(project.initialAssetIds) || !project.initialAssetIds.length)
  ) {
    errors.push("An initial stem must be uploaded when the project has a starting stem");
  }
  if (!project.hasInitialStem) {
    const foundationRoles = (project.requestedRoles || []).filter(
      (role) => role?.foundationEligible,
    );
    if (!foundationRoles.length) {
      errors.push("At least one foundation-eligible role is required without an initial stem");
    }
  }
  if (project.originalWorkConfirmed !== true) {
    errors.push("The original-work declaration must be accepted");
  }
  if (
    project.ownerAgreement?.accepted !== true ||
    project.ownerAgreement?.version !== ORIGINALS_OWNER_AGREEMENT_VERSION
  ) {
    errors.push("The current owner agreement must be accepted");
  }
  return errors;
};
