export const FOX_AND_THE_HOUNDS_ID = '681de07addc311a32c271fd9';

// Rhona explicitly approved these singing-guitar alternatives for Fox. Some
// older musician profiles have incomplete instrumentation; never match by name.
const approvedGuitarLeads = new Set([
  '692867e5e8e46d487634662e', // Rya / Menat Pink — cannot lead-sing and play bass.
  '6946a408a034dd3ebd6a5aa5', // Jeremy Allen
  '69453226a034dd3ebd6a4aa7', // Jake Mackay
  '6946af70a034dd3ebd6a6516', // Lloyd Jerwood
  '6946e6c5a034dd3ebd6a6764', // Luke Roberts
  '6947abf9a034dd3ebd6a77ac', // Sam Monaghan
]);

export function foxVocalDeputyDuties({ actId, isDeputy, musicianId, musician, duties }) {
  if (String(actId || '') !== FOX_AND_THE_HOUNDS_ID || isDeputy !== true ||
      !/vocal/i.test(String(duties || '')) || !/bass/i.test(String(duties || ''))) {
    return duties;
  }

  const instruments = (musician?.instrumentation || []).map(item =>
    String(item?.instrument || '').trim().toLowerCase());
  const hasAcousticBass = instruments.some(value => /acoustic\s+bass|bass\s+guitar\s*\(acoustic\)/i.test(value));
  const hasAcousticGuitar = instruments.some(value => /\bacoustic\s+guitar\b|\bguitar\s*\(acoustic\)/i.test(value));
  const approvedGuitarLead = approvedGuitarLeads.has(String(musicianId || musician?._id || ''));
  if (!approvedGuitarLead && (!hasAcousticGuitar || hasAcousticBass)) return duties;

  // Only replace the offered lead instrument. Preserve dates, sets, setup,
  // finish and enquiry wording, and never change the original lead or fees.
  return String(duties)
    .replace(/vocalist\s*[-/]\s*bassist\b/gi, 'Lead vocals / acoustic guitar')
    .replace(/\bacoustic\s*bass(?:\s+guitar)?\b/gi, 'acoustic guitar')
    .replace(/(\bvocal(?:ist)?s?\s*[/&+-]\s*)bass(?:ist)?(?:\s+guitar)?\b/gi, '$1acoustic guitar');
}
