import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOriginalChatEmail } from '../services/originalsChatNotificationService.js';

test('chat notification includes TSC signature, socials, registered address and a direct chat button', () => {
  const mail = buildOriginalChatEmail({ project: { _id: 'project123', title: 'Test: Dolly Parton 9to5' }, firstName: 'Rhona' });
  assert.equal(mail.subject, 'New group chat message: Test: Dolly Parton 9to5');
  assert.match(mail.html, /TSC ORIGINALS/); assert.match(mail.html, /Hi Rhona,/);
  assert.match(mail.html, /TSC_Signature_2026_svgxr5\.gif/);
  for (const value of ['71-75 Shelton Street', 'WC2H 9JQ', '16883956', 'https://instagram.com/thesupremecollective', 'youtube.com/channel/', 'api.whatsapp.com/send/', 'Rated five stars on Google']) assert.ok(mail.html.includes(value), value);
  assert.match(mail.html, /href="https:\/\/admin\.thesupremecollective\.co\.uk\/originals\/project123#project-chat"/);
  assert.match(mail.html, /Read and reply in the chat/); assert.match(mail.html, /role="presentation"/);
  assert.match(mail.text, /#project-chat/); assert.match(mail.text, /71-75 Shelton Street/); assert.match(mail.text, /Instagram:/);
});

test('personalised HTML escapes names and titles and does not include chat content or attachments', () => {
  const mail = buildOriginalChatEmail({ project: { _id: 'project123', title: '<Song> & "Friends"', body: 'Private message content', attachmentIds: ['private-file'] }, firstName: '<Rhona>' });
  assert.match(mail.html, /&lt;Song&gt; &amp; &quot;Friends&quot;/); assert.match(mail.html, /Hi &lt;Rhona&gt;/);
  assert.doesNotMatch(mail.html, /<Song>|<Rhona>|Private message content|private-file/);
  assert.doesNotMatch(mail.text, /Private message content|private-file/);
});

test('missing names and titles have readable fallbacks', () => {
  const mail = buildOriginalChatEmail({ project: { _id: 'project123' } });
  assert.match(mail.html, /Hi there,/); assert.match(mail.html, /Your Originals project/);
});
