// utils/buildActFilterCard.js
export function buildActFilterCardFromAct(act) {
  const sizes = (act.lineups || []).map((l) => l.actSize).filter(Boolean);
  const minDb = (act.lineups || [])
    .map((l) => Number(String(l.db||'').match(/\d+/)?.[0] || NaN))
    .filter(Number.isFinite)
    .reduce((m, n) => (m == null ? n : Math.min(m, n)), null);

  // wireless summary
  const wirelessByInstrument = {};
  for (const l of (act.lineups || [])) {
    for (const m of (l.bandMembers || [])) {
      if (m?.wireless && m?.instrument) {
        const k = String(m.instrument).toLowerCase().includes('vocal') ? 'vocal'
              : String(m.instrument).toLowerCase();
        wirelessByInstrument[k] = true;
      }
    }
  }

  // repertoire tokens (simple)
  const toTok = (s) => String(s || "").toLowerCase().trim();
  const repertoireTokens = (act.selectedSongs || act.repertoire || [])
    .flatMap((s) => [toTok(s.title || s.song_name), toTok(s.artist)])
    .filter(Boolean);

  return {
    actId: act._id,
    name: act.name,
    tscName: act.tscName,
    status: act.status,
    isTest: !!(act.isTest || act.actData?.isTest),

    genres: Array.isArray(act.genres) ? act.genres : [],
    lineupSizes: Array.from(new Set(sizes)),
    instruments: Array.isArray(act.instruments) ? act.instruments : [],

    wirelessByInstrument,

    hasElectricDrums: !!act.electric_drums,
    hasIEMs: !!act.iems,
    canMakeAcoustic: !!act.can_you_make_act_acoustic,
    canRemoveDrums: !!act.remove_drums,
    minDb,

    setupSupports60: !!act.setup_and_soundcheck_time_60min,
    setupSupports90: !!act.setup_and_soundcheck_time_90min,
    hasSpeedySetup:  !!act.speedy_setup,

    pa: { small: !!act.small_pa_size, medium: !!act.medium_pa_size, large: !!act.large_pa_size },
    light: { small: !!act.small_light_size, medium: !!act.medium_light_size, large: !!act.large_light_size },

    pliAmount: Number(act?.pli?.amount) || 0,

    extras: new Map(Object.entries(act.extras || {})).toObject?.?.() || act.extras || {},

    ceremony: act?.ceremonySets || {},
    afternoon: act?.afternoonSets || {},

    repertoireTokens,
    artistTokens: Array.from(new Set(
      (act.selectedSongs || act.repertoire || [])
        .map((s) => toTok(s.artist))
        .filter(Boolean)
    )),
  };
}