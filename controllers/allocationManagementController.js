import Board from '../models/bookingBoardItem.js';
import Job from '../models/deputyJobModel.js';
import {getActLineupContext} from './allocationController.js';
import {bookingRolePlan,assignmentForSlot,confirmedAllocation} from '../utils/bookingAllocationPolicy.js';
import {upcomingAllocationReview,allocationReviewSummary} from '../services/bookingAllocationReview.js';
export const allocationAdmin=(req,res,next)=>{
 if(!['admin','agent','superadmin','tsc_admin'].includes(String(req.user?.role||'').toLowerCase())&&req.user?.email!=='hello@thesupremecollective.co.uk')return res.status(403).json({success:false,message:'Administrator access required'});
 next();
};
export async function allocationReview(req,res){try{return res.json({success:true,bookings:allocationReviewSummary(await upcomingAllocationReview())});}catch(e){return res.status(500).json({success:false,message:e.message});}}
export async function setAllocationHold(req,res){try{
 const board=await Board.findById(req.params.id);if(!board)return res.status(404).json({success:false,message:'Booking not found'});
 const {lineup}=await getActLineupContext(board);const plan=bookingRolePlan(board,lineup);
 const slot=plan.find(s=>s.roleSlotId===req.body.roleSlotId);if(!slot)return res.status(400).json({success:false,message:'Choose a valid booking role'});
 const active=req.body.active===true,reason=String(req.body.reason||'').trim(),now=new Date();
 const until=req.body.until?new Date(req.body.until):null;
 if(active&&!reason)return res.status(400).json({success:false,message:'Add a reason for holding this role'});
 if(until&&(!Number.isFinite(+until)||until<=now))return res.status(400).json({success:false,message:'The hold end time must be in the future'});
 if(active&&confirmedAllocation(assignmentForSlot(board,slot,plan)))return res.status(409).json({success:false,message:'This role is already confirmed'});
 let hold=(board.allocationHolds||[]).find(h=>h.roleSlotId===slot.roleSlotId);
 if(!hold){board.allocationHolds.push({roleSlotId:slot.roleSlotId,role:slot.role});hold=board.allocationHolds.at(-1);}
 Object.assign(hold,{active,...(active?{reason,until,heldAt:now,heldBy:String(req.user.id||req.user.email),releasedAt:null,releasedBy:''}:{releasedAt:now,releasedBy:String(req.user.id||req.user.email)})});
 await board.save();
 if(active)await Job.updateMany({'automation.bookingBoardItemId':board._id,'automation.roleSlotId':slot.roleSlotId,status:'open'},{$set:{status:'closed','automation.allocationHold':true}});
 else await Job.updateMany({'automation.bookingBoardItemId':board._id,'automation.roleSlotId':slot.roleSlotId,'automation.allocationHold':true,status:'closed'},{$set:{status:'open','automation.allocationHold':false}});
 return res.json({success:true,allocationHolds:board.allocationHolds});
}catch(e){return res.status(500).json({success:false,message:e.message});}}
