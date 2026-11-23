import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarMusicianProfiles,calendarMusicianProfileUrl} from '../utils/calendarMusicianProfiles.js';

const greg='6ac8e16b884d0ae986191b1f',david='6afdf8456466d0601dc60e3d';
test('calendar links use current canonical slugs, with a single lookup for the lineup',async()=>{
  let calls=0;
  const members=await calendarMusicianProfiles([{musicianId:greg,musicianSlug:'old-greg'},{musicianId:david},{musicianId:greg}],{
    loadProfiles:async ids=>{calls++;assert.deepEqual(ids,[greg,david]);return [{_id:greg,musicianSlug:'greg-a'},{_id:david,musicianSlug:'david-a'}];},
  });
  assert.equal(calls,1);assert.match(calendarMusicianProfileUrl(members[0]),/\/musician\/greg-a\/$/);
  assert.match(calendarMusicianProfileUrl(members[1]),/\/musician\/david-a\/$/);
});
test('missing profiles/slugs never fall back to a database ID or a guessed name',async()=>{
  const members=await calendarMusicianProfiles([{musicianId:greg,name:'Greg Adams'}],{loadProfiles:async()=>[{_id:greg}]});
  assert.equal(calendarMusicianProfileUrl(members[0]),'');
  assert.equal(calendarMusicianProfileUrl({musicianSlug:greg}),'');
});
test('roster-only musicians with an explicit slug need no database ID lookup',async()=>{
  const members=await calendarMusicianProfiles([{name:'Sarah',musicianSlug:'sarah-i'}],{loadProfiles:async()=>{throw Error('not required');}});
  assert.match(calendarMusicianProfileUrl(members[0]),/\/musician\/sarah-i\/$/);
});
