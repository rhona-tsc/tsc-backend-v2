import express from 'express';
import {runCalendarDeclineReconciliation} from '../services/calendarDeclineService.js';
const router=express.Router();
// Google push messages contain channel/resource headers, not an event ID.
// Read saved calendars rather than trusting an event ID from the request.
export async function handleCalendarNotifications(_req,res) {
  try { await runCalendarDeclineReconciliation(); }
  catch(error){console.error('Calendar decline reconciliation failed:',error.message);}
  return res.status(200).send('OK');
}
router.post('/notifications',handleCalendarNotifications);
export default router;
