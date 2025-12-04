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
// list
userRouter.get('/list', async (req, res) => {
  try {
    const {
      page = '1',
      limit = '24',
      fields = 'min',
      status,             // optional override
      q,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(60, Math.max(1, parseInt(limit, 10) || 24));

    const filter = {};

    if (status && status !== 'all') filter.status = status;

    if (q && String(q).trim()) {
      const rx = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ tscName: rx }, { name: rx }];
    }

    const projection =
      fields === 'min'
        ? {
            tscName: 1,
            name: 1,
            status: 1,
            'profileImage.0.url': 1,
            'images.0.url': 1,
            'formattedPrice.total': 1,
            'lineups.base_fee': 1,
            useCountyTravelFee: 1,
            countyFeesUpdatedAt: 1,
            timesShortlisted: 1,
            'metrics.shortlists': 1,
          }
        : undefined;

    const cursor = Act.find(filter)
      .select(projection)
      .sort({ bestseller: -1, createdAt: -1, _id: 1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean();

    const [items, total] = await Promise.all([cursor, Act.countDocuments(filter)]);

    res.json({
      success: true,
      items,
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.max(1, Math.ceil(total / limitNum)),
    });
  } catch (error) {
    console.error('❌ /list failed:', error);
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