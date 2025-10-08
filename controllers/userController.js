import validator from "validator";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import userModel from "../models/userModel.js";


const createToken = (id) => {
    return jwt.sign({id}, process.env.JWT_SECRET, {expiresIn: '7d'});
}

// Client login
const loginUser = async (req, res) => {
    try {
        const {email, password} = req.body;
    
        const user  = await userModel
            .findOne({email})
            if (!user) {
                return res.json({success: false, message: "Invalid credentials"});
            }
    
            const isMatch = await bcrypt.compare(password, user.password);
            
            if (isMatch) {
                
                const token = createToken(user._id);
                res.json({success: true, token,  userId: user._id, message: "Login successful"});
    
            }   else {
                res.json({success: false, message: "Invalid credentials"});
            }
    
       }
       catch (error) {
           console.log(error);
           res.json({success: false, message: error.message});
       }
};

// Client registration
const registerUser = async (req, res) => {
    try {
        const {firstName, lastName, email, password, phone} = req.body;

        const exists = await userModel
            .findOne({email})
            if (exists) {
                return res.json({success:false, message: "User already exists"})}
                ;

                // Validating email format and strong password

                if (!validator.isEmail(email)) {
                    return res.json({success: false, message: "Invalid email format"});
                }
                if (password.length < 8) {
                    return res.json({success: false, message: "Password must be at least 8 characters"});
                }
                if (phone.length < 11) {
                    return res.json({success: false, message: "Phone number must be at least 11 characters"});
                }
                // Hashing password
                const salt = await bcrypt.genSalt(10);
                const hashedPassword = await bcrypt.hash(password, salt);

                // Creating new user
                const newUser = new userModel({firstName, lastName, email, phone, password: hashedPassword});

                const user = await newUser.save();

                const token = createToken(user._id);

                res.json({success: true, token,  userId: user._id, message: "Registration successful"});

    } catch (error) {
        console.log(error);
        res.json({success: false, message: error.message});
    }
};



export {loginUser, registerUser};