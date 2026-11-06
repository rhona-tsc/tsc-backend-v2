import test from 'node:test';
import assert from 'node:assert/strict';
import { planOriginalsLaunchAudience } from '../services/originalsLaunchAudienceService.js';
import { musicianEmailHash } from '../utils/musicianEmailPreferences.js';
const musician = (email, extra={}) => ({ _id:email, role:'musician', status:'approved', email, firstName:'Alex', ...extra });

test('launch audience includes approved musicians with pending changes, deduplicates and keeps independent opportunity choices', () => {
  const plan=planOriginalsLaunchAudience([
    musician(' ALEX@MUSIC.CO.UK '), musician('alex@music.co.uk'), musician('sam@music.co.uk',{status:'Approved, changes pending'}), musician('deputy-optout@music.co.uk'), musician('originals-optout@music.co.uk'),
  ],[{emailHash:musicianEmailHash('deputy-optout@music.co.uk'),deputyOpportunities:false},{emailHash:musicianEmailHash('originals-optout@music.co.uk'),originalsOpportunities:false}]);
  assert.deepEqual(plan.recipients.map(row=>row.email),['alex@music.co.uk','deputy-optout@music.co.uk','sam@music.co.uk']);
  assert.equal(plan.excluded.duplicate,1);assert.equal(plan.excluded.unsubscribed,1);
});
test('pending applicants, staff, test or removed profiles and invalid addresses never enter the campaign', () => {
  const plan=planOriginalsLaunchAudience([
    musician('pending@music.co.uk',{status:'pending'}), musician('agent@music.co.uk',{role:'agent'}), musician('private@music.co.uk',{privateTestProfile:true}), musician('deleted@music.co.uk',{profileDeletedAt:new Date()}), musician('bad'), musician('fake@example.test'), musician('removed@music.co.uk'),
  ],[{emailHash:musicianEmailHash('removed@music.co.uk'),profileDeletedAt:new Date()}]);
  assert.equal(plan.recipients.length,0);assert.deepEqual(plan.excluded,{notOnBooks:2,removedOrTest:2,invalidEmail:2,unsubscribed:1,duplicate:0});
});
