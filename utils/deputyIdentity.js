const normalizeEmail = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase();

const normalizeNameToken = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const firstNameOf = (person = {}) => {
  const explicit = normalizeNameToken(person.firstName);
  if (explicit) return explicit;

  const displayName = String(
    person.vocalistName || person.musicianName || person.displayName || "",
  ).trim();
  return normalizeNameToken(displayName.split(/\s+/)[0] || "");
};

const idOf = (person = {}) =>
  String(person.musicianId || person.id || person._id || "").trim();

/**
 * Protects availability requests from stale embedded deputy contact details.
 * A stored deputy may legitimately point at a duplicate profile for the same
 * person, so a matching id, email, or first name is sufficient. If none match,
 * the phone has resolved to a different musician and the send must be blocked.
 */
export function validateDeputyCanonicalIdentity(deputy = {}, canonical = {}) {
  if (!canonical?._id) {
    return { ok: false, reason: "canonical_musician_missing" };
  }

  const deputyId = idOf(deputy);
  const canonicalId = String(canonical._id || "").trim();
  if (deputyId && canonicalId && deputyId === canonicalId) {
    return { ok: true, matchedBy: "musician_id" };
  }

  const deputyEmail = normalizeEmail(deputy.email);
  const canonicalEmail = normalizeEmail(canonical.email);
  if (deputyEmail && canonicalEmail && deputyEmail === canonicalEmail) {
    return { ok: true, matchedBy: "email" };
  }

  const deputyFirstName = firstNameOf(deputy);
  const canonicalFirstName = firstNameOf(canonical);
  if (
    deputyFirstName &&
    canonicalFirstName &&
    deputyFirstName === canonicalFirstName
  ) {
    return { ok: true, matchedBy: "first_name" };
  }

  return {
    ok: false,
    reason: "deputy_phone_resolves_to_different_musician",
    deputyId,
    canonicalId,
    deputyFirstName,
    canonicalFirstName,
    deputyEmail,
    canonicalEmail,
  };
}

