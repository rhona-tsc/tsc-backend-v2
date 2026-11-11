const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
const key = value => clean(value).toLowerCase().replace(/r\s*&\s*b/g, 'rnb').replace(/[^a-z0-9]/g, '');
const styleAliases = {
  soul: ['Soul'], motown: ['Motown'], soulandmotown: ['Soul', 'Motown'], soulmotown: ['Soul', 'Motown'],
  rnb: ['RnB'], randb: ['RnB'], rhythmblue: ['RnB'], rhythmandblues: ['RnB'], hiphop: ['HipHop'], rap: ['HipHop'], garage: ['Garage'],
  rnbhiphopgarage: ['RnB', 'HipHop', 'Garage'], rnbhiphopandgarage: ['RnB', 'HipHop', 'Garage'],
  pop: ['Pop'], classicpop: ['Pop'], chartpop: ['Pop'], popclassicpop: ['Pop'], popandclassicpop: ['Pop'],
  rock: ['Rock'], indie: ['Indie'], indierock: ['Indie', 'Rock'], indieandrock: ['Indie', 'Rock'],
  alternative: ['Alternative'], punk: ['Punk'], alternativepunk: ['Alternative', 'Punk'], alternativeandpunk: ['Alternative', 'Punk'],
  funk: ['Funk'], disco: ['Disco'], funkdisco: ['Funk', 'Disco'], funkanddisco: ['Funk', 'Disco'],
  folk: ['Folk'], acoustic: ['Acoustic'], folkacoustic: ['Folk', 'Acoustic'], folkandacoustic: ['Folk', 'Acoustic'],
  dance: ['Dance'], electronic: ['Electronic'], danceelectronic: ['Dance', 'Electronic'], danceandelectronic: ['Dance', 'Electronic'],
  reggae: ['Reggae'], afrobeat: ['Afrobeat'], reggaeafrobeat: ['Reggae', 'Afrobeat'], reggaeandafrobeat: ['Reggae', 'Afrobeat'],
  israeli: ['Israeli'], latin: ['Latin'], roaming: ['Roaming'], '90s': ['90s'], nineties: ['90s'], '00s': ['00s'], noughties: ['00s'],
};
const instrumentAliases = {
  sax: 'Saxophone', saxophone: 'Saxophone', trumpet: 'Trumpet', trombone: 'Trombone',
  brasssection: 'Brass section', hornsection: 'Brass section',
  keys: 'Keyboard', keyboard: 'Keyboard', keyboards: 'Keyboard', piano: 'Keyboard', pianist: 'Keyboard',
  guitar: 'Guitar', guitarist: 'Guitar', electricguitar: 'Electric Guitar', acousticguitar: 'Acoustic Guitar',
  bass: 'Bass Guitar', bassguitar: 'Bass Guitar', bassist: 'Bass Guitar', drums: 'Drums', drummer: 'Drums', percussion: 'Percussion',
  vocals: 'Vocals', vocal: 'Vocals', vocalist: 'Vocals', singer: 'Vocals', leadvocal: 'Vocals',
  femalevocals: 'Female vocals', femalevocalist: 'Female vocals', leadfemalevocal: 'Female vocals',
  malevocals: 'Male vocals', malevocalist: 'Male vocals', leadmalevocal: 'Male vocals',
  rapper: 'Rapper', rap: 'Rapper', mc: 'Rapper', violin: 'Violin', fiddle: 'Violin',
};
const horns = ['Saxophone', 'Trumpet', 'Trombone'];
const unique = values => [...new Set(values)];

export function parsePreferredSize(raw = '') {
  let value = clean(raw).toLowerCase().replace(/[–—]/g, '-').replace(/(\d+)piece/g, '$1 piece');
  if (!value || /^(any|flexible|not decided|unsure|open)$/.test(value)) return { any: true, values: [] };
  const named = { solo: 1, duo: 2, trio: 3, quartet: 4, quintet: 5, sextet: 6,
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  value = value.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g, word => String(named[word]));
  const namedSizes = Object.entries(named).filter(([word]) => new RegExp(`\\b${word}\\b`).test(value)).map(([, size]) => size);
  const numbers = [...value.matchAll(/\b\d+\b/g)].map(match => Number(match[0]));
  let values = unique([...namedSizes, ...numbers]);
  if (values.some(size => size < 1 || size > 20)) return { unknown: true, values: [] };
  const range = value.match(/\b(\d+)\s*(?:-|to|and)\s*(\d+)\b/);
  if (range && !/\bor\b/.test(value)) {
    const [lo, hi] = [Number(range[1]), Number(range[2])];
    if (lo > hi || lo < 1 || hi > 20) return { unknown: true, values: [] };
    values = Array.from({ length: hi - lo + 1 }, (_, index) => lo + index);
  } else if (values.length === 1 && /\bat least\b|\bminimum\b/.test(value)) values = Array.from({ length: 21 - values[0] }, (_, i) => values[0] + i);
  else if (values.length === 1 && /\bup to\b|\bmaximum\b/.test(value)) values = Array.from({ length: values[0] }, (_, i) => i + 1);
  if (!values.length || values.some(size => size < 1 || size > 20)) return { unknown: true, values: [] };
  // Do not discard extra constraints such as "5-piece plus a DJ".
  const residue = value.replace(/\b(solo|duo|trio|quartet|quintet|sextet|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|piece|pieces|musicians?|band|or|and|between|to|at least|minimum|up to|maximum)\b/g, '').replace(/[\d\s/,-]/g, '');
  return residue ? { unknown: true, values: [] } : { any: false, values: values.sort((a, b) => a - b) };
}

function styleKeys(value) {
  const direct = styleAliases[key(value)];
  if (direct) return direct;
  const parts = clean(value).split(/\s+(?:or|and)\s+|[,/&]/i).filter(Boolean);
  if (parts.length > 1 && parts.every(part => styleAliases[key(part)])) return unique(parts.flatMap(part => styleAliases[key(part)]));
  return [];
}

export function normalizeBandSearch(input = {}) {
  if (typeof input === 'string') input = { query: input };
  if ((input.query !== undefined && typeof input.query !== 'string') || (input.preferredSize !== undefined && typeof input.preferredSize !== 'string')) throw new Error('Band name and preferred size must be text.');
  if (input.styleMatch !== undefined && !['any', 'all'].includes(input.styleMatch)) throw new Error('Confirm whether all styles are required or they are alternatives.');
  const list = value => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 20 || value.some(item => typeof item !== 'string' || item.length > 100)) throw new Error('Supply a short list of music styles or instruments.');
    return unique(value.map(clean).filter(Boolean));
  };
  let query = clean(input.query).slice(0, 120);
  const styles = list(input.styles);
  // Retain compatibility with the old style-only lookup tool.
  const legacyStyle = query.replace(/\b(wedding|bands?|hire)\b/gi, '').trim();
  if (styleKeys(legacyStyle).length) { styles.push(legacyStyle); query = ''; }
  const instruments = list(input.mustHaveInstruments);
  const preferredSize = clean(input.preferredSize).slice(0, 80);
  const unknown = [
    ...styles.filter(style => !styleKeys(style).length).map(style => `style: ${style}`),
    ...instruments.filter(instrument => !instrumentAliases[key(instrument)]).map(instrument => `instrument: ${instrument}`),
  ];
  const size = parsePreferredSize(preferredSize);
  if (size.unknown) unknown.push(`size: ${preferredSize}`);
  return { query, styles: unique(styles.flatMap(styleKeys)), preferredSize, size, styleMatch: input.styleMatch === 'all' ? 'all' : 'any',
    mustHaveInstruments: unique(instruments.map(instrument => instrumentAliases[key(instrument)]).filter(Boolean)), unknown };
}

function memberInstruments(raw) {
  const value = clean(raw).toLowerCase();
  const found = [];
  if (/sax/.test(value)) found.push('Saxophone');
  if (/trumpet/.test(value)) found.push('Trumpet');
  if (/trombone/.test(value)) found.push('Trombone');
  if (/keyboard|\bkeys\b|piano/.test(value)) found.push('Keyboard');
  if (/bass/.test(value)) found.push('Bass Guitar');
  if (/guitar|guitarist/.test(value) && !/bassist|bass[ -]?guitar/.test(value)) {
    found.push('Guitar');
    if (/acoustic/.test(value)) found.push('Acoustic Guitar');
    if (/electric/.test(value)) found.push('Electric Guitar');
  }
  if (/drum/.test(value)) found.push('Drums');
  if (/percussion/.test(value)) found.push('Percussion');
  if (/vocal|singer|rapper|\bmc\b/.test(value)) found.push('Vocals');
  if (/female/.test(value)) found.push('Female vocals');
  else if (/\bmale\b/.test(value)) found.push('Male vocals');
  if (/rapper|\bmc\b/.test(value)) found.push('Rapper');
  if (/violin|fiddle/.test(value)) found.push('Violin');
  return found;
}

function hasSeparateHornPlayers(required, members, used = new Set()) {
  if (!required.length) return true;
  return members.some((instruments, index) => !used.has(index) && instruments.includes(required[0]) && hasSeparateHornPlayers(required.slice(1), members, new Set([...used, index])));
}

function publicLineup(lineup) {
  const members = (lineup.bandMembers || []).filter(member => clean(member.instrument) && !/^manager$/i.test(clean(member.instrument)));
  const roles = members.map(member => memberInstruments(member.instrument));
  const recordedSize = Number(clean(lineup.actSize).match(/\d+/)?.[0] || 0);
  // The catalogue contains unused blank member rows; these are not performers.
  const sizeNeedsReview = !recordedSize || members.length !== recordedSize;
  return { lineupId: String(lineup.lineupId || lineup._id || ''), size: sizeNeedsReview ? null : recordedSize,
    recordedSize, sizeNeedsReview, instruments: unique(roles.flat()), hornPlayers: roles.filter(items => items.some(item => horns.includes(item))).length, roles };
}

export function matchVoiceBands(acts, input = {}, selection = {}) {
  const criteria = normalizeBandSearch(input);
  const constraints = { styles: criteria.styles, styleMatch: criteria.styleMatch, preferredSize: criteria.preferredSize, mustHaveInstruments: criteria.mustHaveInstruments };
  const result = { bands: [], constraints, totalMatches: 0, availabilityChecked: false, pricesQuoted: false, needsClarification: false, reviewNotes: [] };
  if (criteria.unknown.length) return { ...result, needsClarification: true, reviewNotes: [`Please clarify ${criteria.unknown.join('; ')}. Do not silently ignore these requirements.`] };
  if (!criteria.query && !criteria.styles.length && !criteria.preferredSize && !criteria.mustHaveInstruments.length) return { ...result, needsClarification: true, reviewNotes: ['Ask for a music style, band size, instrument requirement or band name.'] };
  const matches = [];
  for (const act of acts) {
    if (!['approved', 'live', 'approved_changes_pending', 'live_changes_pending'].includes(act.status) || act.isTest === true) continue;
    if (selection.actId && String(act._id) !== String(selection.actId)) continue;
    const name = clean(act.tscName || act.name);
    if (!name || (criteria.query && !key(name).includes(key(criteria.query)))) continue;
    const genres = unique([...(act.genre || []), ...(act.genres || [])]);
    const keys = unique(genres.flatMap(styleKeys));
    if (criteria.styles.length && !(criteria.styleMatch === 'all' ? criteria.styles.every(style => keys.includes(style)) : criteria.styles.some(style => keys.includes(style)))) continue;
    const lineups = (act.lineups || []).map(publicLineup).filter(lineup => {
      if (!lineup.lineupId) return false;
      if (selection.lineupId && lineup.lineupId !== selection.lineupId) return false;
      if (!criteria.size.any && (lineup.sizeNeedsReview || !criteria.size.values.includes(lineup.size))) return false;
      if (criteria.mustHaveInstruments.includes('Brass section') && lineup.hornPlayers < 2) return false;
      if (!hasSeparateHornPlayers(criteria.mustHaveInstruments.filter(instrument => horns.includes(instrument)), lineup.roles)) return false;
      return criteria.mustHaveInstruments.every(instrument => instrument === 'Brass section' || lineup.instruments.includes(instrument));
    });
    if ((act.lineups || []).some(lineup => publicLineup(lineup).sizeNeedsReview)) result.reviewNotes.push(`${name}: at least one lineup size needs staff verification.`);
    if (!lineups.length) continue;
    matches.push({ actId: String(act._id), name, genres,
      profile: act.slug ? `https://thesupremecollective.co.uk/act/${encodeURIComponent(act.slug)}/` : '',
      lineups: lineups.sort((a, b) => (a.size || 99) - (b.size || 99)).map(({ roles, recordedSize, ...lineup }) => lineup),
      score: criteria.styles.filter(style => keys.includes(style)).length });
  }
  result.totalMatches = matches.length;
  result.bands = matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 3).map(({ score, ...band }) => ({ ...band, lineups: band.lineups.slice(0, 3) }));
  result.reviewNotes = unique(result.reviewNotes).filter(note => !result.bands.length || result.bands.some(band => note.startsWith(`${band.name}:`))).slice(0, 3);
  if (!result.bands.length) result.reviewNotes.push('No verified lineup matches these requirements. Ask before changing a preference; otherwise save the enquiry for staff review.');
  return result;
}
