import express from 'express';
import { loginUser, registerUser } from '../controllers/userController.js';
import Act from '../models/actModel.js';
import { forgotPassword, resetPassword } from "../controllers/authController.js";
import { getAvailableActIds } from '../controllers/actAvailabilityController.js';
import actCardModel from '../models/actCard.model.js';
import requireAdminDashboard from '../middleware/requireAdminDashboard.js';
import userModel from '../models/userModel.js';

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

// routes: app.use('/api/act', router);
userRouter.get('/cards', async (req, res) => {
  try {
    const statuses = String(req.query.status || 'approved,live').split(',').map(s => s.trim());
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const sort = String(req.query.sort || '-createdAt');
    const sortObj = sort.startsWith('-') ? { [sort.slice(1)]: -1 } : { [sort]: 1 };

    // If you already have ActCard model, use that; otherwise use the aggregate below
    const cards = await actCardModel.find({ status: { $in: statuses } })
      .select('actId imageUrl basePrice loveCount name tscName availabilityBadge')
      .sort(sortObj).limit(limit).lean();

    return res.json({ success: true, acts: cards });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
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

userRouter.get("/all", requireAdminDashboard, async (req, res) => {
  try {
    const users = await userModel
      .find({})
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, users });
  } catch (e) {
    console.error("GET /api/user/all error:", e);
    return res.status(500).json({ success: false, message: e.message });
  }
});

export default userRouter;