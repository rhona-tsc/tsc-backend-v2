import Musician from '../models/musicianModel.js';
import { chatDisplayName } from './originalsChatService.js';

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const list = value => Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
const unique = values => [...new Set(values.filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean))];
const instrumentFields = ['instrument', 'instruments', 'instrumentation.instrument'];
const voiceTypes = ['Lead Vocalist', 'Backing Vocalist', 'Lead Vocalist-Instrumentalist', 'Backing Vocalist-Instrumentalist'];
const canonicalInstruments = ['Vocal', 'Guitar', 'Bass', 'Keys', 'Drums', 'Percussion', 'Saxophone', 'Trumpet', 'Trombone', 'Violin'];
const badRequest = message => Object.assign(new Error(message), { status: 400 });
function textParam(value, name, max) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.trim().length > max) throw badRequest(`Invalid ${name} filter`);
  return value.trim();
}
export function originalInstrumentFilter(instrument) {
  const key = instrument.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
  let pattern;
  if (['vocal','vocals','vocalist','vocalists','singer','singers'].includes(key)) {
    pattern = /(?:^|[\s-])(?:vocals?|vocalists?|singers?)(?:$|[\s-])/i;
    return { $or: [...instrumentFields.map(field => ({ [field]: pattern })), { 'vocals.type': { $in: voiceTypes.map(type => new RegExp(`^\\s*${escape(type)}\\s*$`, 'i')) } }] };
  }
  if (['keys','keyboard','keyboards'].includes(key)) pattern = /(?:keyboard|piano|pianist|keys|organ|synth|keytar)/i;
  else if (['piano','pianist'].includes(key)) pattern = /(?:piano|pianist)/i;
  else if (['guitar','guitars','guitarist'].includes(key)) pattern = /^(?!.*\bbass\b).*(?:guitar|guitarist)/i;
  else if (['bass','bassist','bass guitar'].includes(key)) pattern = /(?:\bbass\b|bassist|contrabass)/i;
  else if (['drums','drum kit','drummer'].includes(key)) pattern = /(?:drums?|drummer)/i;
  else if (['sax','saxophone','saxophonist'].includes(key)) pattern = /(?:saxophone|saxophonist|\bsax\b)/i;
  else pattern = new RegExp(`^\\s*${escape(instrument)}\\s*$`, 'i');
  return { $or: [...instrumentFields.map(field => ({ [field]: pattern })), { 'vocals.type': pattern }] };
}

export async function browseOriginalMusicians(params = {}, { allowEmail = false } = {}) {
  const q = textParam(params.q, 'name', 80);
  const instrument = textParam(params.instrument, 'instrument', 80);
  const genre = textParam(params.genre, 'genre', 100);
  const pageText = params.page === undefined ? '1' : String(params.page);
  if (!/^\d{1,5}$/.test(pageText) || Number(pageText) < 1 || Number(pageText) > 10000) throw badRequest('Invalid results page');
  const page = Number(pageText), pageSize = 25;
  const conditions = [];
  if (q) {
    for (const term of q.split(/\s+/).slice(0, 6)) {
      const pattern = new RegExp(escape(term), 'i');
      const fields = ['firstName', 'lastName', 'basicInfo.firstName', 'basicInfo.lastName'];
      if (allowEmail) fields.push('email');
      conditions.push({ $or: fields.map(field => ({ [field]: pattern })) });
    }
  }
  if (instrument) conditions.push(originalInstrumentFilter(instrument));
  if (genre) {
    const pattern = new RegExp(`^\\s*${escape(genre)}\\s*$`, 'i');
    conditions.push({ $or: [{ 'vocals.genres': pattern }, { genres: pattern }] });
  }
  const query = conditions.length ? { $and: conditions } : {};
  const records = await Musician.find(query)
    .select('firstName lastName basicInfo.firstName basicInfo.lastName musicianSlug instrument instruments instrumentation vocals.type vocals.genres genres')
    .sort({ firstName: 1, lastName: 1, _id: 1 }).skip((page - 1) * pageSize).limit(pageSize + 1).lean();
  const musicians = records.slice(0, pageSize).map(item => {
    const name = [item.firstName || item.basicInfo?.firstName, item.lastName || item.basicInfo?.lastName].filter(Boolean).join(' ');
    return {
      _id: item._id, displayName: chatDisplayName(name) || 'Musician',
      instruments: unique([item.instrument, ...list(item.instruments), ...list(item.instrumentation).map(role => role?.instrument), ...list(item.vocals?.type).filter(type => voiceTypes.includes(type))]),
      genres: unique([...list(item.vocals?.genres), ...list(item.genres)]),
      profilePath: `/musician/${encodeURIComponent(String(item.musicianSlug || item._id).trim())}`,
    };
  });
  const result = { success: true, musicians, pagination: { page, pageSize, hasMore: records.length > pageSize, hasPrevious: page > 1 } };
  if (params.includeFilters === 'true' || params.includeFilters === true) {
    const [instrument, instruments, instrumentation, vocals, vocalGenres, genres] = await Promise.all([
      ...instrumentFields.map(field => Musician.distinct(field)),
      Musician.distinct('vocals.type'), Musician.distinct('vocals.genres'), Musician.distinct('genres'),
    ]);
    result.filters = {
      instruments: unique([...canonicalInstruments, ...instrument, ...instruments, ...instrumentation, ...vocals.filter(type => voiceTypes.includes(type))]).filter(value => value.length <= 80).sort((a,b) => a.localeCompare(b, 'en')),
      genres: unique([...vocalGenres, ...genres]).filter(value => value.length <= 100).sort((a,b) => a.localeCompare(b, 'en')),
    };
  }
  return result;
}
