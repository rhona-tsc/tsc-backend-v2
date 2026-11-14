import mongoose from 'mongoose';
import { google } from 'googleapis';
import { openEquipmentToken } from './voiceEquipmentGoogle.js';

// Private, read-only reference. Never accept a spreadsheet ID/range from a request.
export const VOCALIST_RATES_ID = '1Cv0rr7V5-ohf89cx2EzvzKF14XLLlbubiD53iqEOD2w';
export const LINEUP_RATES_ID = '1L6cim0tjAgs4CQ6kd1xi7m0IbqbESt6R1WQeoNQwE_c';
const TAB = 'Saturdays / & December Dates';
const RANGES = ['A1:AT2', 'A3:H200', 'J3:AT100'].map(range => `'${TAB}'!${range}`);
const hold = message => Object.assign(new Error(message), { code: 'DEPUTY_PRICING_UNCONFIRMED' });
const normal = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const phone = value => normal(value).replace(/^0(?=7)/, '44');
const email = value => String(value || '').trim().toLowerCase();
const money = value => {
  const text = String(value ?? '').trim();
  if (!/^£?\s*\d+(?:,\d{3})*(?:\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text.replace(/[£,\s]/g, ''));
  return Number.isFinite(amount) ? amount : null;
};
const column = index => { let label = ''; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + (n - 1) % 26) + label; return label; };

// Rosters also contain blank-instrument manager/crew rows. They are costs,
// not an extra performer when matching the approved lineup’s musician count.
export const performanceLineupSize = lineup => (lineup?.bandMembers || []).filter(member =>
  String(member.instrument || '').trim() && !/manager|engineer|technician|crew/i.test(member.instrument)).length;

let cached, inFlight;
export async function readAutomaticDeputyRates() {
  if (cached && Date.now() - cached.cachedAt < 120000) return cached;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const record = await mongoose.connection.db.collection('voice_equipment_google_connections').findOne({ _id: 'reference' });
    if (!record?.refreshTokenEncrypted) throw hold('Read-only vocalist rates connection is unavailable.');
    const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    auth.setCredentials({ refresh_token: openEquipmentToken(record.refreshTokenEncrypted) });
    const sheets = google.sheets({ version: 'v4', auth });
    const metadata = await sheets.spreadsheets.get({ spreadsheetId: VOCALIST_RATES_ID, fields: 'sheets(properties(title,gridProperties))' }, { timeout: 6000 });
    const grid = metadata.data.sheets?.find(item => item.properties?.title === TAB)?.properties?.gridProperties;
    if (!grid || grid.rowCount < 200 || grid.columnCount < 46) throw hold('Vocalist rates layout needs review.');
    const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId: VOCALIST_RATES_ID, ranges: RANGES, valueRenderOption: 'FORMATTED_VALUE' }, { timeout: 6000 });
    const [headers, singers, counties] = response.data.valueRanges.map(item => item.values || []);
    await sheets.spreadsheets.get({ spreadsheetId: LINEUP_RATES_ID, fields: 'sheets(properties(title,gridProperties))' }, { timeout: 6000 });
    const master = await sheets.spreadsheets.values.get({ spreadsheetId: LINEUP_RATES_ID, range: "'Lineup master'!A5:X100", valueRenderOption: 'FORMATTED_VALUE' }, { timeout: 6000 });
    const [roleHeaders, ...roleRows] = master.data.values || [];
    if (roleHeaders?.[8] !== 'Lead vocal base' || roleHeaders?.[9] !== 'Additional vocal base') throw hold('Lineup master vocalist columns need review.');
    cached = { headers, singers, counties, roleRows, readAt: new Date().toISOString(), cachedAt: Date.now() };
    return cached;
  })().catch(() => { throw hold('Current vocalist base and travel rates could not be verified; no deputy request sent.'); }).finally(() => { inFlight = null; });
  return inFlight;
}

export function calculateAutomaticDeputyPrice({ rates, musician, county, dateISO, actName = '', bandSize, essentialRoles = [] }) {
  if (!musician?._id || !county) throw hold('Canonical deputy identity and destination county are required.');
  const matches = rates.singers.map((row, index) => ({ row, sheetRow: index + 3 })).filter(({ row }) =>
    (phone(musician.phoneNormalized || musician.phone || musician.phoneNumber) && phone(row[2]) === phone(musician.phoneNormalized || musician.phone || musician.phoneNumber)) ||
    (email(musician.email) && email(row[3]) === email(musician.email)));
  if (matches.length !== 1) throw hold('An exact, unique contact match in Vocalist Rates is required.');
  const { row, sheetRow } = matches[0];
  const date = new Date(`${String(dateISO).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) throw hold('A valid event date is required.');
  if (String(dateISO).slice(5, 10) === '12-31') throw hold('New Year’s Eve deputy pricing needs an explicitly confirmed holiday rate.');
  const baseColumn = date.getUTCMonth() === 11 || date.getUTCDay() === 6 ? 5 : date.getUTCDay() === 0 ? 6 : 7;
  const personalBase = money(row[baseColumn]);
  if (!(personalBase > 0)) throw hold(`Deputy base rate is missing or unconfirmed at ${column(baseColumn)}${sheetRow}.`);
  const roleRows = (rates.roleRows || []).map((values, index) => ({ values, sheetRow: index + 6 }))
    .filter(item => [item.values[0], item.values[1]].some(name => normal(name) === normal(actName)) && Number(item.values[4]) === Number(bandSize));
  const roleRates = roleRows.map(item => {
    const values = [5, 6].filter(index => Number(item.values[index]) > 0).map(index => money(item.values[index + 3]));
    if (!values.length || values.some(value => !(value > 0))) throw hold('Lineup master vocalist fee is unconfirmed.');
    return Math.min(...values);
  });
  if (!roleRates.length || new Set(roleRates).size !== 1) throw hold('Exact act/lineup vocalist minimum needs review in Lineup master.');
  // Never reduce the act’s current minimum (e.g. Motown Luxe £355) to an old
  // roster value or the default £300 personal rate. Higher personal rates win.
  const roleMinimum = roleRates[0];
  const base = Math.max(personalBase, roleMinimum);
  // Notes can qualify the rate (VAT, restrictions, etc.); do not silently discard them.
  if (String(row[4] || '').trim()) throw hold(`Deputy rate notes at E${sheetRow} require review.`);
  const countyRows = rates.counties.map((values, index) => ({ values, sheetRow: index + 3 })).filter(item => normal(item.values[0]) === normal(county));
  if (countyRows.length !== 1) throw hold(`Exact travel rate for ${county} is missing or ambiguous.`);
  const destination = countyRows[0];
  const name = normal(row[1]);
  const ownColumns = (rates.headers[1] || []).map((header, index) => ({ header: String(header || ''), index })).filter(({ header, index }) =>
    index >= 18 && index < 40 && header.split(/\s*&\s*|\s+and\s+|\s*\(/i).some(part => normal(part).length >= 3 && name.startsWith(normal(part))));
  if (ownColumns.length > 1) throw hold('Multiple personal travel columns match this deputy.');
  const own = ownColumns[0];
  if (own && /only/i.test(own.header) && !(normal(actName).includes('motownluxe') && /motown\s*luxe/i.test(own.header))) throw hold('Act-specific personal travel requires review for this act.');
  // O is the sheet’s London-based travel TOTAL, including return fuel/time/overnight.
  // Named non-London columns take precedence; no mileage or act-wide fallback.
  const travelColumn = own?.index ?? 14;
  if (!own && !/london based vocalists/i.test(String(rates.headers[0]?.[9] || ''))) throw hold('Default London travel heading could not be verified.');
  const travel = money(destination.values[travelColumn - 9]);
  if (travel === null) throw hold(`Deputy travel is missing or unconfirmed at ${column(travelColumn)}${destination.sheetRow}.`);
  let extras = 0;
  for (const role of essentialRoles.filter(item => item?.isEssential)) {
    const fee = money(role.additionalFee);
    if (fee === null) throw hold('An essential role fee is unconfirmed.');
    extras += fee;
  }
  return {
    total: Math.round((base + travel + extras) * 100) / 100, base, personalBase, roleMinimum, travel, essentialExtras: extras,
    source: 'vocalist_rates', spreadsheetId: VOCALIST_RATES_ID, tab: TAB,
    baseCell: `${column(baseColumn)}${sheetRow}`, travelCell: `${column(travelColumn)}${destination.sheetRow}`,
    roleRateSource: { spreadsheetId: LINEUP_RATES_ID, tab: 'Lineup master', rows: roleRows.map(item => item.sheetRow) },
    county, dateISO: String(dateISO).slice(0, 10), musicianId: String(musician._id), verifiedAt: rates.readAt,
  };
}

export async function resolveAutomaticDeputyPrice(input) {
  const rates = await readAutomaticDeputyRates();
  return calculateAutomaticDeputyPrice({ ...input, rates });
}
