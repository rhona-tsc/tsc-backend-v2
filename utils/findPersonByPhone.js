// Normaliser used everywhere
function normalizePhoneE164(raw = "") {
  let s = String(raw || "").trim().replace(/^whatsapp:/i, "").replace(/\s+/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("07")) return s.replace(/^0/, "+44");
  if (s.startsWith("44")) return `+${s}`;
  return s;
}

export const findPersonByPhone = (act, lineupId, fromValue) => {
  if (!act) return null;
  const q = normalizePhoneE164(fromValue);
  if (!q) return null;

  const allLineups = Array.isArray(act.lineups) ? act.lineups : [];
  const primary = lineupId
    ? allLineups.filter(
        (l) =>
          l._id?.toString?.() === String(lineupId) ||
          String(l.lineupId) === String(lineupId)
      )
    : allLineups;

  const same = (v) => normalizePhoneE164(v) === q;

  const searchIn = (lineups) => {
    for (const l of lineups) {
      const members = Array.isArray(l.bandMembers) ? l.bandMembers : [];
      for (const m of members) {
        // prefer normalized, then fallbacks
        if (same(m.phoneNormalized) || same(m.phoneNumber) || same(m.phone)) {
          console.log("✅ findPersonByPhone matched member", {
            q,
            matched: m.phoneNormalized || m.phoneNumber || m.phone,
            name: `${m.firstName || ""} ${m.lastName || ""}`.trim(),
          });
          return { type: "member", person: m, parentMember: null, lineup: l };
        }

        const deputies = Array.isArray(m.deputies) ? m.deputies : [];
        for (const d of deputies) {
          if (same(d.phoneNormalized) || same(d.phoneNumber) || same(d.phone)) {
            console.log("✅ findPersonByPhone matched deputy", {
              q,
              matched: d.phoneNormalized || d.phoneNumber || d.phone,
              name: `${d.firstName || ""} ${d.lastName || ""}`.trim(),
            });
            return { type: "deputy", person: d, parentMember: m, lineup: l };
          }
        }
      }
    }
    return null;
  };

  // Prefer the requested lineup, otherwise search everything
  return searchIn(primary) || searchIn(allLineups);
};