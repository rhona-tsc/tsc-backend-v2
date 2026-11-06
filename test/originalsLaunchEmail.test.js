import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOriginalsLaunchEmail } from '../utils/originalsLaunchEmail.js';
import { addMusicianEmailPreferences } from '../utils/musicianEmailPreferences.js';

test('launch draft uses the shared brand, a project button and preference footer while escaping recipient names', () => {
  const mail=buildOriginalsLaunchEmail({firstName:'<Sam & Alex>'});
  assert.match(mail.html,/Hi &lt;Sam &amp; Alex&gt;,/);
  assert.doesNotMatch(mail.html,/<Sam/);
  assert.match(mail.html,/TSC ORIGINALS/);
  assert.match(mail.html,/bgcolor="#ff6667"/);
  assert.match(mail.html,/Explore TSC Originals/);
  assert.match(mail.html,/\/originals"/);
  assert.match(mail.html,/Find us online/);
  assert.match(mail.text,/royalties due through TSC paid twice a year/);
  const withPreferences=addMusicianEmailPreferences({...mail});
  assert.match(withPreferences.html,/Manage email preferences or unsubscribe/);
  assert.doesNotMatch(withPreferences.html,/<!-- musician-email-preferences -->/);
});
