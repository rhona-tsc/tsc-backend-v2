import mongoose from 'mongoose';
// Kept separately from booking documents: public booking responses never include grants.
const schema=new mongoose.Schema({
 bookingId:{type:mongoose.Schema.Types.ObjectId,required:true,unique:true,index:true},
 token:{type:String,required:true,select:false},
 tokenHash:{type:String,required:true,select:false},
 expiresAt:{type:Date,required:true,index:true},
 revokedAt:{type:Date,default:null},
},{timestamps:true});
export default mongoose.models.EventSheetUploadGrant || mongoose.model('EventSheetUploadGrant',schema);
