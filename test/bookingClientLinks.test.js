import test from 'node:test';import assert from 'node:assert/strict';
import {clientEventSheetUrl, externalClientLink} from '../utils/bookingClientLinks.js';
import {finalDetailsDueISO} from '../utils/finalDetailsDueDate.js';
import {buildAutomation10Email,runClientAutomations} from '../services/clientAutomationService.js';
test('migrated reminders use the original client sheet and preserve the agreed deadline',()=>{
 const row={bookingRef:'OLD',clientFirstNames:'Lara',eventDateISO:'2027-04-03',importMetadata:{clientEventSheetUrl:'https://bit.ly/Lara-And-Toms-Wedding',clientEventSheetDueDateISO:'2027-03-25'}};
 assert.equal(clientEventSheetUrl(row),'https://bit.ly/Lara-And-Toms-Wedding');assert.match(buildAutomation10Email(row).text,/https:\/\/bit.ly\/Lara-And-Toms-Wedding/);assert.equal(finalDetailsDueISO(row),'2027-03-25');
 assert.equal(externalClientLink({importMetadata:{clientInvoiceUrl:'javascript:alert(1)'}},'invoice'),'');
});
test('Alex review hold prevents sending even with the booking switch and sender on',async()=>{
 const previous=process.env.CLIENT_AUTOMATIONS_ENABLED;process.env.CLIENT_AUTOMATIONS_ENABLED='true';
 try {const result=await runClientAutomations({now:new Date('2026-11-25T12:00:00Z'),bookingModel:{find:()=>({lean:async()=>[{_id:'held',bookingRef:'BBM 499 BREWERS',siteAutomationsEnabled:true,importMetadata:{clientAutomationReviewPending:true}}]})},emailSender:()=>{throw Error('must not send');}});assert.equal(result.sent,0);assert.equal(result.skipped,1);}finally{if(previous===undefined)delete process.env.CLIENT_AUTOMATIONS_ENABLED;else process.env.CLIENT_AUTOMATIONS_ENABLED=previous;}
});
