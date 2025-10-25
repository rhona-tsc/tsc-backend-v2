import express from 'express';
import upload from '../middleware/multer.js';
import {
  createActV2,
  getActByIdV2,
  getAllActsV2,
  removeAct,
  singleAct,
  updateActStatus,
  updateActV2
} from '../controllers/actV2Controller.js';
import musicianAuth from '../middleware/adminAuth.js';
import agentAuth from '../middleware/agentAuth.js';

const actRouter = express.Router();

/* -----------------------------------------------------------
   🔹 Legacy / Base Routes (still supported for compatibility)
----------------------------------------------------------- */

// GET: List all acts (legacy)
actRouter.get('/list', (req, res, next) => {
  console.log('📡 Route hit: GET /api/act/list');
  next();
}, getAllActsV2);

// POST: Add new act (authenticated musicians only)
actRouter.post('/add', musicianAuth, upload, createActV2);

// POST: Update act status (agents/admins)
actRouter.post('/status', agentAuth, updateActStatus);

// POST: Remove act
actRouter.post('/remove', removeAct);

// POST: Get single act (legacy)
actRouter.post('/single', singleAct);

/* -----------------------------------------------------------
   🔹 V2 Routes (preferred, stable API)
----------------------------------------------------------- */

actRouter.get('/v2/acts', (req, res, next) => {
  console.log('🚀 Route hit: GET /api/v2/acts', req.query);
  next();
}, getAllActsV2);

actRouter.get('/v2/acts/:id', (req, res, next) => {
  console.log('📡 Route hit: GET /api/v2/acts/:id', req.params.id);
  next();
}, getActByIdV2);

actRouter.post('/v2/acts', (req, res, next) => {
  console.log('🆕 Route hit: POST /api/v2/acts');
  next();
}, createActV2);

actRouter.put('/v2/acts/:id', (req, res, next) => {
  console.log('✏️ Route hit: PUT /api/v2/acts/:id', req.params.id);
  next();
}, updateActV2);

export default actRouter;