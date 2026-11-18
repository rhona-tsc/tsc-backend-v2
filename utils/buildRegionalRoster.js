// Pure, idempotent roster preparation. Does not write records or send messages.
export function buildRegionalRoster({
  act,
  roster,
  resolvePerson,
  newId,
  newLineupId,
}) {
  const pending = [];
  const personName = (p) =>
    [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
  const snapshot = (p) => ({
    musicianId: String(p._id || p.musicianId || p.id || ""),
    firstName: p.firstName || p.basicInfo?.firstName || "",
    lastName: p.lastName || p.basicInfo?.lastName || "",
    email: (p.email || p.basicInfo?.email || "").trim().toLowerCase(),
    phoneNumber: p.phone || p.phoneNumber || p.basicInfo?.phone || "",
    image: p.profilePhoto || p.image || "",
  });
  const lineups = (act.lineups || []).map((l) => ({
    ...l,
    bandMembers: (l.bandMembers || []).map((m) => ({
      ...m,
      deputies: (m.deputies || []).map((d) => ({ ...d })),
    })),
  }));
  const findMember = (l, role) =>
    l.bandMembers.find(
      (m) =>
        new RegExp(role.instrumentPattern, "i").test(m.instrument || "") &&
        (!role.primaryMatch ||
          new RegExp(role.primaryMatch, "i").test(personName(m))),
    );
  const bandLineups = lineups.filter((l) =>
    roster.bandSizes.includes(Number(String(l.actSize).match(/\d+/)?.[0])),
  );
  const keys = roster.roles.find((r) => r.insert);
  for (const l of bandLineups) {
    if (keys && !findMember(l, keys)) {
      const declared = Number(String(l.actSize).match(/\d+/)?.[0]);
      const performers = l.bandMembers.filter((m) =>
        String(m.instrument || "").trim(),
      );
      if (performers.length !== declared - 1)
        throw Error(
          `Review ${l.actSize}: missing keys cannot be inserted without changing the declared size`,
        );
      const profile = resolvePerson(keys.primary);
      if (!profile)
        throw Error(
          "The new keys original must have a uniquely matched profile",
        );
      l.bandMembers.push({
        _id: newId(),
        ...snapshot(profile),
        instrument: keys.instrument,
        fee: 200,
        isEssential: true,
        additionalRoles: [],
        regions: keys.primaryRegions,
        deputies: [],
      });
    }
  }
  const ninth = roster.extraLineup;
  if (
    ninth &&
    !lineups.some(
      (l) => Number(String(l.actSize).match(/\d+/)?.[0]) === ninth.size,
    )
  ) {
    const base = lineups.find(
      (l) => Number(String(l.actSize).match(/\d+/)?.[0]) === ninth.copySize,
    );
    if (!base) throw Error("Base lineup missing for optional trombone lineup");
    const role = roster.roles.find((r) => r.instrument === ninth.instrument),
      profile = resolvePerson(role.primary);
    const parts = role.primary.split(/\s+/);
    const member = {
      _id: newId(),
      ...(profile
        ? snapshot(profile)
        : {
            musicianId: "",
            firstName: parts.shift(),
            lastName: parts.join(" "),
            email: "",
            phoneNumber: "",
          }),
      instrument: role.instrument,
      fee: 200,
      isEssential: true,
      additionalRoles: [],
      regions: role.primaryRegions,
      deputies: [],
    };
    if (!profile)
      pending.push({
        name: role.primary,
        role: role.instrument,
        regions: role.primaryRegions,
        priority: -1,
      });
    lineups.push({
      ...base,
      _id: newId(),
      lineupId: newLineupId(),
      actSize: `${ninth.size}-Piece`,
      base_fee: [],
      bandMembers: [
        ...base.bandMembers.map((m) => ({
          ...m,
          _id: newId(),
          deputies: m.deputies.map((d) => ({ ...d })),
        })),
        member,
      ],
    });
  }
  const targetLineups = lineups.filter((l) =>
    [...roster.bandSizes, roster.extraLineup?.size].includes(
      Number(String(l.actSize).match(/\d+/)?.[0]),
    ),
  );
  for (const l of lineups)
    for (const role of roster.roles) {
      if (!role.allLineups && !targetLineups.includes(l)) continue;
      const member = findMember(l, role);
      if (!member) continue;
      member.regions = role.primaryRegions || [];
      if (role.primary && !member.musicianId && !resolvePerson(role.primary))
        pending.push({
          name: role.primary,
          role: member.instrument,
          regions: role.primaryRegions || [],
          priority: -1,
        });
      const merged = new Map();
      for (const [region, names] of Object.entries(role.pools))
        for (let priority = 0; priority < names.length; priority++) {
          const name = names[priority],
            profile = resolvePerson(name);
          const existing = member.deputies.find(
            (d) => personName(d).toLowerCase() === name.toLowerCase(),
          );
          const value = profile ? snapshot(profile) : existing;
          if (!value) {
            pending.push({
              name,
              role: member.instrument,
              regions: region === "all" ? [] : [region],
              priority,
            });
            continue;
          }
          const key = String(
            value.musicianId || value.id || value._id || personName(value),
          );
          if (key === String(member.musicianId)) continue;
          if (!merged.has(key))
            merged.set(key, { ...value, regions: [], regionalPriority: {} });
          const d = merged.get(key);
          if (region !== "all") d.regions.push(region);
          else d.allRegions = true;
          if (region !== "all") d.regionalPriority[region] = priority;
        }
      member.deputies = [...merged.values()].map(({ allRegions, ...d }) => ({
        ...d,
        regions: allRegions ? [] : [...new Set(d.regions)],
      }));
    }
  const uniquePending = [
    ...new Map(
      pending.map((p) => [`${p.name}|${p.role}|${p.regions.join(",")}`, p]),
    ).values(),
  ].sort(
    (a, b) =>
      a.role.localeCompare(b.role) ||
      a.name.localeCompare(b.name) ||
      a.regions.join(",").localeCompare(b.regions.join(",")),
  );
  // An allocation-only addition must not publish an unpriced website option.
  const hiddenWebsiteLineupIds = [...(act.hiddenWebsiteLineupIds || [])];
  if (ninth?.allocationOnly) {
    const optional = lineups.find(
      (l) => Number(String(l.actSize).match(/\d+/)?.[0]) === ninth.size,
    );
    const key = String(optional.lineupId || optional._id);
    if (!hiddenWebsiteLineupIds.includes(key)) hiddenWebsiteLineupIds.push(key);
  }
  return {
    lineups,
    hiddenWebsiteLineupIds,
    policy: { exclusions: roster.exclusions, pendingMatches: uniquePending },
    summary: {
      lineups: lineups.map((l) => ({
        size: l.actSize,
        performers: l.bandMembers.filter((m) => m.instrument).length,
      })),
      pendingMatches: uniquePending,
    },
  };
}
