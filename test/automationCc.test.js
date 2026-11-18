import test from 'node:test';
import assert from 'node:assert/strict';
import {automationCc} from '../utils/automationCc.js';
test('booking-specific copies include only validated distinct extra recipients',()=>{
 assert.deepEqual(automationCc({clientEmail:'trevor@bubblesanimation.com',automationCcEmails:['OFFICE@bubblesanimation.com','office@bubblesanimation.com','trevor@bubblesanimation.com','bad']}),['office@bubblesanimation.com']);
 assert.deepEqual(automationCc({clientEmails:[{email:'not-an-approved-copy@example.com'}]}),[]);
});
