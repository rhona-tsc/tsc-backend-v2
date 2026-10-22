import { actNameGroups } from '../data/actNameAliases.js';
export const actNameKey = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

export function createActNameResolver(acts, groups = actNameGroups) {
  const claims = new Map();
  const candidates = groups.map((names, index) => ({ owner: `group-${index}`, names }));
  for (const act of acts) {
    const names = [act.name, act.tscName, act.slug?.replace(/-/g, ' ')].filter(Boolean);
    const matching = candidates.filter(group => group.names.some(name => names.some(value => actNameKey(name) === actNameKey(value))));
    if (matching.length === 1) matching[0].act = matching[0].act ? null : act;
    else if (!matching.length) candidates.push({ owner: `act-${act._id}`, names, act });
  }
  for (const group of candidates) {
    const names = [...group.names, group.act?.name, group.act?.tscName].filter(Boolean);
    for (const name of names) {
      const key = actNameKey(name);
      if (!claims.has(key)) claims.set(key, new Map());
      claims.get(key).set(group.owner, group.act || null);
    }
  }
  const ids = new Map(acts.map(act => [String(act._id), act]));
  return (name, id) => {
    if (id && ids.has(String(id))) return ids.get(String(id));
    const owners = claims.get(actNameKey(name));
    return owners?.size === 1 ? [...owners.values()][0] : null;
  };
}
