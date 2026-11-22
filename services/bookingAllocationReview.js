import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Board from '../models/bookingBoardItem.js';
import Job from '../models/deputyJobModel.js';
import {getActLineupContext,postExhaustedRoleToDeputyBoard} from '../controllers/allocationController.js';
import {londonDay,daysUntilBooking,withinAllocationWeek,activeAllocationHold,activeBooking,bookingRolePlan,assignmentForSlot,confirmedAllocation,bookingAssignments} from '../utils/bookingAllocationPolicy.js';
import {isVocalRole} from '../utils/calendarBookingIdentity.js';

export async function upcomingAllocationReview({now=new Date(),days=365}={}) {
 const start=londonDay(now),end=new Date(Date.parse(`${start}T00:00:00Z`)+days*86400000).toISOString().slice(0,10);
 const boards=await Board.find({eventDateISO:{$gte:start,$lte:end},bookingStatus:{$ne:'cancelled'}}).sort({eventDateISO:1}).lean();
 const rows=[];
 for(const board of boards){
  if(!activeBooking(board))continue;
  const {act,lineup}=await getActLineupContext(board);
  const plan=bookingRolePlan(board,lineup);
  const slots=plan.map(slot=>{
   const assignment=assignmentForSlot(board,slot,plan),hold=activeAllocationHold(board,slot.roleSlotId,now);
   const fee=Number(assignment?.totalFee||assignment?.fee||0);
   return {...slot,assignment,hold,fee,confirmed:confirmedAllocation(assignment),clientApprovalRequired:Boolean(board.allocation?.managerApprovalRequired&&isVocalRole(slot.role))};
  });
  const missing=slots.filter(s=>!s.confirmed);
  if(!missing.length&&plan.length)continue;
  rows.push({board,act,lineup,slots:missing,daysUntil:daysUntilBooking(board.eventDateISO,now),urgent:withinAllocationWeek(board.eventDateISO,now),needsSetup:!plan.length||!act||!bookingAssignments(board).length});
 }
 return rows;
}
export const allocationReviewSummary=rows=>rows.map(({board,act,slots,daysUntil,urgent,needsSetup})=>({
 id:String(board._id),bookingRef:board.bookingRef,date:board.eventDateISO,act:board.actTscName||act?.tscName||board.actName||act?.name||'',daysUntil,urgent,needsSetup,
 missing:slots.map(s=>({role:s.role,roleSlotId:s.roleSlotId,status:s.assignment?.status||'unfilled',musician:s.assignment?.name||'',fee:s.fee,hold:s.hold?{reason:s.hold.reason,until:s.hold.until}:null,clientApprovalRequired:s.clientApprovalRequired})),
}));

export async function runBookingAllocationEscalation({now=new Date(),review=upcomingAllocationReview,postRole=postExhaustedRoleToDeputyBoard,locks=mongoose.connection.collection('automationlocks'),jobs=Job,boards=Board}={}) {
 const owner=crypto.randomUUID(),key='booking-allocation-seven-day';
 try{await locks.findOneAndUpdate({_id:key,$or:[{leaseUntil:{$lt:now}},{leaseUntil:{$exists:false}}]},{$set:{owner,leaseUntil:new Date(+now+10*60*1000)}},{upsert:true});}
 catch(e){if(e.code===11000)return {locked:true};throw e;}
 try{
  const rows=await review({now,days:7});const outcomes=[];
  // Release only job-board pauses created by an expired allocation hold.
  const paused=await jobs.find({'automation.allocationHold':true,status:'closed'});
  for(const job of paused){const board=await boards.findById(job.automation.bookingBoardItemId).lean();if(board&&activeBooking(board)&&!activeAllocationHold(board,job.automation.roleSlotId,now)) {job.status='open';job.automation.allocationHold=false;await job.save();}}
  for(const row of rows)for(const slot of row.slots){
   if(!row.urgent||slot.confirmed)continue;
   let blocked=slot.hold?'held':slot.clientApprovalRequired?'client_approval_required':!row.act?'act_not_linked':!slot.fee?'fee_not_recorded':'';
   if(blocked){outcomes.push({bookingRef:row.board.bookingRef,role:slot.role,blocked});continue;}
   const board=row.board;
   const job=await postRole({bookingBoardItemId:board._id,bookingRef:board.bookingRef,roleSlotId:slot.assignment?.roleSlotId||slot.roleSlotId,duties:slot.role,fee:slot.fee,formattedAddress:board.address||board.venue,meta:{role:slot.role,MetaISODate:board.eventDateISO,county:board.county,callTime:board.arrivalTime,startTime:board.startTime,finishTime:board.finishTime,escalationReason:'because the role remains unfilled within seven days of the event'}},row.act);
   outcomes.push({bookingRef:board.bookingRef,role:slot.role,jobId:job?._id});
  }
  return {checkedBookings:rows.length,outcomes};
 }finally{await locks.deleteOne({_id:key,owner});}
}
