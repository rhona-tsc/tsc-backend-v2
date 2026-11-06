import test from 'node:test';
import assert from 'node:assert/strict';
import { originalsEmailExamples } from './helpers/originalsEmailExamples.js';

for (const { name, message } of originalsEmailExamples()) {
  test(`${name} uses the shared Originals header, project button and footer`, () => {
    assert.equal((message.html.match(/<!doctype html>/g) || []).length, 1);
    assert.match(message.html, /<html lang="en">/);
    assert.equal((message.html.match(/>TSC ORIGINALS<\/p>/g) || []).length, 1);
    assert.match(message.html, /background:#111111;border-radius:20px 20px 0 0/);
    assert.equal((message.html.match(/bgcolor="#ff6667"/g) || []).length, 1);
    assert.equal((message.html.match(/TSC_Signature_2026_svgxr5/g) || []).length, 1);
    assert.equal((message.html.match(/Registered Office:/g) || []).length, 1);
    assert.match(message.html, /Company Number: 16883956/);
    assert.match(message.text, /Company Number: 16883956/);
    const button = message.html.match(/<td bgcolor="#ff6667"[^>]*>\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>/);
    assert.ok(button, 'A labelled action button is required');
    const url = new URL(button[1].replaceAll('&amp;', '&'));
    assert.match(url.protocol, /^https?:$/);
    assert.ok(url.pathname.startsWith('/originals'));
    assert.ok(message.text.includes(url.href), 'Plain text must include the same action destination');
    assert.ok(message.html.indexOf('<h1') < message.html.indexOf('bgcolor="#ff6667"'));
    assert.ok(message.html.indexOf('bgcolor="#ff6667"') < message.html.indexOf('Registered Office:'));
  });
}

test('every personalised email escapes user text inside the shared layout', () => {
  const malicious = '<script>alert("example")</script>';
  for (const { name, message } of originalsEmailExamples({ project: { title: malicious, description: malicious, ownerName: malicious }, firstName: malicious, roleName: malicious, note: malicious })) {
    assert.doesNotMatch(message.html, /<script>|<\/script>/, name);
    assert.match(message.html, /&lt;script&gt;/, name);
  }
});

test('closed-round action goes to the project list when workspace access may have ended', () => {
  const { message } = originalsEmailExamples().find(example => example.name === 'round-closed');
  assert.match(message.html, /View Originals projects/);
  assert.doesNotMatch(message.html, /\/originals\/example-project/);
});
