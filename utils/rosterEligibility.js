import { postcodes } from "./postcodes.js";
const clean = (v) => String(v || "").trim();
export const personName = (p) =>
  clean(
    p?.name ||
      [
        p?.firstName || p?.basicInfo?.firstName,
        p?.lastName || p?.basicInfo?.lastName,
      ]
        .filter(Boolean)
        .join(" "),
  );
const norm = (v) =>
  clean(v)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
const id = (p) => clean(p?.musicianId || p?._id || p?.id);
export const sameRosterPerson = (a, b) =>
  Boolean(
    (id(a) && id(a) === id(b)) ||
      (personName(a) && norm(personName(a)) === norm(personName(b))) ||
      (a?.aliases || []).some((name) => norm(name) === norm(personName(b))),
  );

export const ROSTER_REGIONS = ["south", "north", "scotland"];
const north =
  /\b(cheshire|cumbria|lancashire|manchester|merseyside|cleveland|durham|northumberland|tyne|yorkshire|humberside|derbyshire|leicestershire|lincolnshire|nottinghamshire|rutland|shropshire|staffordshire|warwickshire|west midlands|worcestershire|herefordshire|ceredigion|conwy|conway|denbighshire|flintshire|gwynedd|wrexham)\b/i;
const south =
  /\b(london|bedfordshire|berkshire|buckinghamshire|cambridgeshire|norfolk|suffolk|sussex|essex|hampshire|hertfordshire|isle of wight|kent|oxfordshire|surrey|cornwall|devon|dorset|gloucestershire|somerset|wiltshire|cardiff|carmarthenshire|monmouthshire|pembrokeshire|powys|swansea|northamptonshire)\b/i;
export function rosterRegion({ region, county, address } = {}) {
  if (ROSTER_REGIONS.includes(region)) return region;
  const match = clean(address)
    .toUpperCase()
    .match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2}\b/);
  const table = Array.isArray(postcodes) ? postcodes[0] || {} : postcodes || {};
  const mapped = match
    ? Object.entries(table)
        .find(
          ([, codes]) => Array.isArray(codes) && codes.includes(match[1]),
        )?.[0]
        ?.replace(/_/g, " ")
    : "";
  const text = [county || mapped || address].filter(Boolean).join(" ");
  if (
    /\b(scotland|edinburgh|glasgow|aberdeen|dundee|inverness|perth|stirling)\b/i.test(
      text,
    )
  )
    return "scotland";
  if (north.test(text)) return "north";
  if (south.test(text)) return "south";
  return "";
}
export function selectedRosterPeople(
  lineup,
  assignments = [],
  { roleSlotId, memberId } = {},
) {
  const active = assignments.filter(
    (p) =>
      ![
        "declined",
        "cancelled",
        "removed",
        "unavailable",
        "withdrawn",
      ].includes(clean(p?.status).toLowerCase()),
  );
  const others = active.filter(
    (p) =>
      !(roleSlotId && p.roleSlotId === roleSlotId) &&
      !(memberId && clean(p.originalBandMemberId) === clean(memberId)),
  );
  // Use actual replacements where a role is allocated; use originals only for unfilled roles.
  const originals = (lineup?.bandMembers || []).filter(
    (m) =>
      m.instrument &&
      clean(m._id) !== clean(memberId) &&
      !active.some(
        (p) =>
          clean(p.originalBandMemberId) === clean(m._id) ||
          (p.roleSlotId &&
            p.roleSlotId ===
              `${clean(m.instrument)
                .toLowerCase()
                .replace(
                  /[^a-z0-9]+/g,
                  "-",
                )}-${(lineup.bandMembers || []).filter((x) => x.instrument === m.instrument).indexOf(m) + 1}`),
      ),
  );
  return [...others, ...originals];
}
export function rosterEligibility({
  candidate,
  member,
  lineup,
  assignments = [],
  policy,
  region,
  county,
  address,
  roleSlotId,
} = {}) {
  member =
    member ||
    (lineup?.bandMembers || []).find(
      (m) =>
        sameRosterPerson(candidate, m) ||
        (m.deputies || []).some((d) => sameRosterPerson(candidate, d)),
    );
  const area = rosterRegion({ region, county, address });
  const primary = member && sameRosterPerson(candidate, member);
  const entry = primary
    ? member
    : (member?.deputies || []).find((d) => sameRosterPerson(candidate, d));
  const regions = entry?.regions || [];
  if (regions.length && (!area || !regions.includes(area)))
    return {
      eligible: false,
      reason: area
        ? `Not in the ${area} pool for this role`
        : "Confirm the event county before selecting a regional musician",
      region: area,
    };
  const people = selectedRosterPeople(lineup, assignments, {
    roleSlotId,
    memberId: member?._id,
  });
  for (const rule of policy?.exclusions || []) {
    const isSubject = sameRosterPerson(rule.person, candidate);
    const isOther = (rule.withPeople || []).some((p) =>
      sameRosterPerson(p, candidate),
    );
    if (
      (isSubject &&
        people.some((p) =>
          (rule.withPeople || []).some((x) => sameRosterPerson(x, p)),
        )) ||
      // Self-exclusions use the other-role people above, not the current
      // role's own existing assignment in the reverse-order check.
      (isOther &&
        !isSubject &&
        assignments
          .filter(
            (p) =>
              ![
                "declined",
                "cancelled",
                "removed",
                "unavailable",
                "withdrawn",
              ].includes(clean(p?.status).toLowerCase()),
          )
          .some((p) => sameRosterPerson(rule.person, p)))
    ) {
      return {
        eligible: false,
        reason:
          rule.reason ||
          "This combination of musicians is excluded for this act",
        region: area,
      };
    }
  }
  return { eligible: true, reason: "", region: area };
}
// Keep the agreed deputy order as the tiebreaker. Transport is a soft
// preference and uses confirmed evidence, not an assumption about other players.
export function rosterTransportPriority(candidate, { member, policy, ...context } = {}) {
  const preference = policy?.transportPreference;
  if (!preference?.preferLondonCarOwners) return 0;
  if (preference.rolePattern) {
    try { if (!new RegExp(preference.rolePattern, 'i').test(member?.instrument || '')) return 0; }
    catch { return 0; }
  }
  const others = selectedRosterPeople(context.lineup, context.assignments || [], {
    roleSlotId: context.roleSlotId, memberId: member?._id,
  });
  const needsLift = (preference.nonDrivers || []).some(person =>
    others.some(other => sameRosterPerson(person, other)));
  if (!needsLift) return 0;
  return (preference.londonCarOwners || []).some(person => sameRosterPerson(person, candidate)) ? 0 : 1;
}
export function eligibleRosterDeputies({ member, ...context } = {}) {
  const region = rosterRegion(context);
  return (member?.deputies || [])
    .map((p, i) => ({ p, i }))
    .filter(
      ({ p }) =>
        rosterEligibility({ ...context, member, candidate: p }).eligible,
    )
    .sort(
      (a, b) =>
        rosterTransportPriority(a.p, { ...context, member }) - rosterTransportPriority(b.p, { ...context, member }) ||
        (a.p.regionalPriority?.[region] ?? a.i) -
        (b.p.regionalPriority?.[region] ?? b.i),
    )
    .map(({ p }) => p);
}

export function selectRosterMember({ member, ...context }) {
  const selected = (context.assignments || []).find(a =>
    a.source === 'lineup_upgrade' && !a.withdrawnAt &&
    ['selected', 'proposed', 'offered', 'accepted', 'confirmed'].includes(a.status) &&
    clean(a.originalBandMemberId) === clean(member._id));
  const selectedDeputy = selected && (member.deputies || []).find(d => sameRosterPerson(d, selected));
  if (selectedDeputy && rosterEligibility({ ...context, member, candidate: selectedDeputy }).eligible)
    return { ...(member.toObject?.() || member), ...selectedDeputy,
      musicianId: id(selectedDeputy), _id: member._id, instrument: member.instrument,
      deputies: member.deputies };
  if (rosterEligibility({ ...context, member, candidate: member }).eligible)
    return member;
  const deputy = eligibleRosterDeputies({ ...context, member })[0];
  return deputy
    ? {
        ...(member.toObject?.() || member),
        ...deputy,
        musicianId: id(deputy),
        _id: member._id,
        instrument: member.instrument,
        deputies: member.deputies,
      }
    : null;
}
