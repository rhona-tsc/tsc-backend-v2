export const isBespokeLineup = row => row?.lineupMode === "bespoke" || row?.lineupId === "bespoke";
export function normaliseBespokeLineup(row) {
  if (!isBespokeLineup(row)) return row;
  if (!Array.isArray(row.lineupSlots)) throw new Error("Bespoke lineups require musician slots");
  const lineupSlots = row.lineupSlots.map(slot => ({
    role: String(slot?.role || "").trim(), excluded: slot?.excluded === true,
  })).filter(slot => slot.role);
  const lineupComposition = lineupSlots.filter(slot => !slot.excluded).map(slot => slot.role);
  if (!lineupComposition.length) throw new Error("A bespoke lineup needs at least one active musician");
  return { ...row, lineupId: "bespoke", lineupMode: "bespoke", lineupSlots,
    lineupComposition, bandSize: lineupComposition.length,
    lineupSelected: `Bespoke ${lineupComposition.length}-piece` };
}
export function bespokeLineupSnapshot(row, previous = {}) {
  const normalised = normaliseBespokeLineup(row);
  const availableMembers = [...(previous.bandMembers || [])];
  const bandMembers = normalised.lineupComposition.map(instrument => {
    const index = availableMembers.findIndex(member => String(member.instrument || member.role || "").trim() === instrument);
    return index < 0 ? { instrument } : { ...availableMembers.splice(index, 1)[0], instrument };
  });
  return { ...previous, _id: "bespoke", lineupId: "bespoke", actSize: normalised.lineupSelected, bandMembers };
}
export function updateBespokeSummary(summary, row) {
  const lineup = bespokeLineupSnapshot(row, summary.lineup || { bandMembers: summary.bandMembers });
  return { ...summary, lineupId: "bespoke", lineupLabel: row.lineupSelected,
    bandSize: row.bandSize, bandMembers: lineup.bandMembers, lineup };
}
