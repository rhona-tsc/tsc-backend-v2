import test from 'node:test';
import assert from 'node:assert/strict';
import {getSectionAttachments} from '../utils/eventSheetAttachments.js';
const url = name => `https://res.cloudinary.com/example/raw/upload/v123/event-sheets/docs/${name}`;
test('collects section-specific attachments with their band-facing labels', () => {
 const docs = getSectionAttachments({location_documents:[{name:'Access.pdf',url:url('access.pdf')}],parking_documents:[{name:'Permit.png',url:url('permit.png')}],room_area_documents:[{name:'Room.docx',url:url('room.docx')}]},'example');
 assert.deepEqual(docs.map(d=>d.section),['Location & Load-in','Parking','Room & Area']);
 assert.equal(docs[2].name,'Room.docx');
});
test('PDF generation cannot fetch arbitrary hosts, paths or credentials from new attachment fields', () => {
 for (const bad of ['http://127.0.0.1/private','https://res.cloudinary.com.evil.test/example/raw/upload/v123/event-sheets/docs/a.pdf',url('../a.pdf'),url('a.html'),url('a.pdf')+'?redirect=private',url('a.pdf').replace('/example/','/another-account/')]) {
  assert.deepEqual(getSectionAttachments({parking_documents:[{url:bad}]},'example'),[]);
 }
});
