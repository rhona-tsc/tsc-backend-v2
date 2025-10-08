import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
    firstName: {type: String, required: true},
    lastName: {type: String, required: true},
    email: {type: String, required: true, unique: true},
    password: {type: String, required: true},
    phone: {type: String, required: true},
    cartData: {type: Object, default: {}},
    shortlistData: {type: Object, default: {}},
    shortlistedActs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'act' }],
    resetPasswordToken: { type: String, default: null },
resetPasswordExpires: { type: Date, default: null },
    
}, {minimize:false})

const userModel = mongoose.models.user || mongoose.model('user', userSchema);

export default userModel