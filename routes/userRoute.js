import express from 'express';
import { loginUser, registerUser } from '../controllers/userController.js';
import Act from '../models/actModel.js';
import { forgotPassword, resetPassword } from "../controllers/authController.js";
import { getAvailableActIds } from '../controllers/actAvailabilityController.js';

const userRouter = express.Router();

userRouter.post('/register', registerUser);
userRouter.post('/login', loginUser);
userRouter.post("/user/forgot-password", forgotPassword);
userRouter.post("/user/reset-password", resetPassword);

// list
userRouter.get('/list', async (req, res) => {
  try {
    const acts = await Act.find().sort({ createdAt: -1 });
    res.json({ success: true, acts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ✅ put the specific route BEFORE the catch-all param route
userRouter.get('/acts-available', getAvailableActIds);

// get by id – constrain to Mongo ObjectId shape to avoid catching /acts-available
userRouter.get('/:id([0-9a-fA-F]{24})', async (req, res) => {
  try {
    const act = await Act.findById(req.params.id);
    if (!act) return res.status(404).json({ error: 'Act not found' });
    res.json(act);
  } catch (err) {
    console.error('❌ Error fetching act:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default userRouter;