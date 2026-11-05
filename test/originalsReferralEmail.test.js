import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOriginalReferralEmail } from '../services/originalsReferralService.js';

const project = { _id: 'project123', title: 'Original song', description: 'Soulful vocals and live drums.\nRecord at 110 BPM.' };
const referral = { fullName: 'Rowan Thomas', referrerName: 'Britney', roleName: 'Drums', email: 'rowan@example.test' };

test('recommendation includes the full brief, named encouragement and shared branded footer in both formats', () => {
  const mail = buildOriginalReferralEmail({ project, referral, token: 'secret' });
  assert.equal(mail.to, referral.email);
  assert.equal(mail.subject, 'Britney recommended you for Drums');
  assert.ok(mail.text.includes(`Britney saw this original project “Original song”, which is looking for someone to fill the role of “Drums”`));
  assert.ok(mail.text.includes(project.description));
  assert.match(mail.html, /Soulful vocals and live drums\.<br>Record at 110 BPM\./);
  for (const content of [mail.html, mail.text]) {
    assert.match(content, /Follow Britney’s recommendation as soon as you can to make sure you don’t miss out on this opportunity to contribute!/);
    assert.match(content, /Warmest wishes,/);
    assert.match(content, /71-75 Shelton Street/);
    assert.match(content, /16883956/);
    assert.match(content, /instagram.com\/thesupremecollective/);
    assert.match(content, /youtube.com/);
    assert.doesNotMatch(content, /access.*project only|reserve a slot|guarantee selection/i);
  }
  assert.match(mail.html, /TSC_Signature_2026_svgxr5.gif/);
  assert.match(mail.html, /Chat on WhatsApp/);
  const href = mail.html.match(/<a href="([^"]+)"[^>]*>View the project and take part<\/a>/)?.[1];
  assert.ok(href);
  const url = new URL(href);
  assert.equal(url.pathname, '/originals/project123');
  assert.equal(url.searchParams.get('referral'), 'secret');
  assert.ok(mail.text.includes(href));
});

test('all personalised fields and multiline briefs render as text, without injecting HTML or extra links', () => {
  const mail = buildOriginalReferralEmail({
    project: { ...project, title: '<Song> & "Friends"', description: '<img src=x onerror=alert(1)>\r\nSecond line\rThird line' },
    referral: { ...referral, fullName: '<Rowan>', referrerName: '<Britney>', roleName: '<Drums>' },
    token: 'secret&"<>',
  });
  assert.match(mail.html, /&lt;Rowan&gt;/);
  assert.match(mail.html, /&lt;Britney&gt;/);
  assert.match(mail.html, /&lt;Drums&gt;/);
  assert.match(mail.html, /&lt;Song&gt; &amp; &quot;Friends&quot;/);
  assert.match(mail.html, /&lt;img src=x onerror=alert\(1\)&gt;<br>Second line<br>Third line/);
  assert.doesNotMatch(mail.html, /<img src=x|<Rowan>|<Britney>|<Drums>|<Song>/);
  assert.match(mail.html, /referral=secret%26%22%3C%3E/);
});

test('legacy projects without a brief still provide a working invitation and clear fallback', () => {
  const mail = buildOriginalReferralEmail({ project: { _id: 'legacy', title: 'Older project' }, referral, token: 'secret' });
  assert.match(mail.html, /Read the project brief in the workspace\./);
  assert.match(mail.text, /Read the project brief in the workspace\./);
  assert.match(mail.html, /\/originals\/legacy\?referral=secret/);
  assert.doesNotMatch(mail.html, /undefined|null/);
});
