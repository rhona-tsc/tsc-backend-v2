import express from 'express';
import Act from '../models/actModel.js';
import User from '../models/userModel.js';
import {
  notifyMusician,
  shortlistActAndTrack,
} from '../controllers/shortlistController.js';
import {
  triggerAvailabilityRequest,
  makeAvailabilityBroadcaster,
  twilioStatus,
  clearAvailabilityBadge,
  twilioInbound
} from '../controllers/availabilityController.js';

const router = express.Router();

// --- in-memory SSE hub for availability updates ---
const sseClients = new Set();
const broadcastAvailability = (payload) => {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch {}
  }
};
const availabilityNotify = makeAvailabilityBroadcaster(broadcastAvailability);

// ✅ Expose the broadcaster for controller code that calls availabilityNotify.leadYes/deputyYes
global.availabilityNotify = availabilityNotify;

// If you need CORS preflight for POSTs from the web app:
router.options('/add', (req, res) => res.sendStatus(200));
router.options('/toggle', (req, res) => res.sendStatus(200));

router.post('/availability/request', triggerAvailabilityRequest);

// Your shortlist endpoint that also mirrors to Enquiry Board
router.post('/add', shortlistActAndTrack);
// ✅ Alias so you can call /api/shortlist/toggle as well
router.post('/toggle', shortlistActAndTrack);

// PATCH /api/shortlist/act/:id/increment-shortlist
router.patch('/act/:id/increment-shortlist', async (req, res) => {
  const { userId, updateTimesShortlisted } = req.body;
  const actId = req.params.id;

  try {
    // 1. Increment shortlist counters on the act
    const actUpdates = {
      $inc: {
        numberOfShortlistsIn: 1,
        ...(updateTimesShortlisted && { timesShortlisted: 1 }),
      },
    };
    await Act.findByIdAndUpdate(actId, actUpdates, { new: true });

    // 2. Add act to the user's shortlist if not already added
    if (userId) {
      await User.findByIdAndUpdate(
        userId,
        { $addToSet: { shortlistedActs: actId } }, // avoids duplicates
        { new: true }
      );
    }

    return res.json({ success: true, message: "Shortlist updated" });
  } catch (err) {
    console.error("❌ Failed to update shortlist:", err);
    return res.status(500).json({ error: 'Failed to update shortlist counters.' });
  }
});

// PATCH /api/shortlist/act/:id/decrement-shortlist
router.patch('/act/:id/decrement-shortlist', async (req, res) => {
  const { userId } = req.body;
  const actId = req.params.id;

  try {
    await Act.findByIdAndUpdate(
      actId,
      { $inc: { numberOfShortlistsIn: -1 } },
      { new: true }
    );

    if (userId) {
      await User.findByIdAndUpdate(
        userId,
        { $pull: { shortlistedActs: actId } },
        { new: true }
      );
    }

    return res.json({ success: true, message: "Shortlist decremented" });
  } catch (err) {
    console.error("❌ Failed to decrement shortlist:", err);
    return res.status(500).json({ error: 'Failed to decrement shortlist counter.' });
  }
});

// Get the current user's shortlisted acts (populated)
router.get('/user/:userId/shortlisted', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId || userId === 'undefined') {
      return res.status(400).json({ success: false, message: 'Missing userId' });
    }
    const user = await User.findById(userId).populate('shortlistedActs');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    return res.json({ success: true, acts: user.shortlistedActs });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Disable compression for SSE and set explicit CORS for the stream
const sseNoCompression = (req, res, next) => {
  // if you're using the `compression` middleware, this flag tells it to skip
  req.headers['x-no-compression'] = '1';
  next();
};

// Live subscribe to availability updates over SSE
router.get('/availability/subscribe', sseNoCompression, (req, res) => {
  console.log('📡 SSE subscribe: /api/shortlist/availability/subscribe');
  // Resolve ACAO dynamically – support multiple frontends
  const ALLOWED_SSE_ORIGINS = new Set(
    [
      process.env.FRONTEND_URL,
      'https://tsc2025.netlify.app',
      'https://www.thesupremecollective.co.uk',
      'https://thesupremecollective.co.uk',
      'http://localhost:5173',
      'http://localhost:5174'
    ].filter(Boolean)
  );
  const reqOrigin = req.headers.origin || '';
  const acao = ALLOWED_SSE_ORIGINS.has(reqOrigin)
    ? reqOrigin
    : (process.env.FRONTEND_URL || 'https://tsc2025.netlify.app');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Origin', acao);
  // EventSource does not send cookies by default; no need for credentials
  // If you later enable withCredentials on the client, flip this to 'true'
  res.setHeader('Access-Control-Allow-Credentials', 'false');
  // Prevent proxy buffering (NGINX/Heroku/etc.)
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  console.log('   ↳ SSE ACAO:', acao);

  // Advise the client to retry quickly if the connection drops
  res.write('retry: 5000\n\n');
  // Send an initial no-op event so clients mark as open
  res.write('event: open\n');
  res.write(`data: ${Date.now()}\n\n`);

  // Initial comment keeps some proxies happy
  res.write(': connected\n\n');

  // Heartbeat to keep the connection alive
  const heartbeat = setInterval(() => {
    res.write('event: ping\n');
    res.write(`data: ${Date.now()}\n\n`);
  }, 25000);

  sseClients.add(res);
  console.log(`👥 SSE clients: ${sseClients.size}`);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
    console.log('🔌 SSE client disconnected. Clients:', sseClients.size);
    try { res.end(); } catch {}
  });
});

router.post('/notify-musician', notifyMusician);

router.post('/twilio/inbound', express.urlencoded({ extended: false }), twilioInbound);
router.post('/twilio/status',  express.urlencoded({ extended: false }), twilioStatus);

// Clear the availability badge (e.g., when Google Calendar webhook signals a decline)
router.post('/availability/badge/clear', clearAvailabilityBadge);

// Google Calendar push webhook → when you detect a decline, POST here with { actId }
router.post('/google/notifications', async (req, res) => {
  try {
    const { actId, action } = req.body || {};
    if (action === 'declined' && actId) {
      // Reuse the controller to clear the badge
      await clearAvailabilityBadge({ body: { actId } }, {
        status: (c) => ({ json: (o) => res.status(c).json(o) }),
        json: (o) => res.json(o)
      });
    } else {
      res.status(200).json({ ok: true });
    }
  } catch (e) {
    console.error('❌ google/notifications error', e);
    res.status(500).json({ ok: false });
  }
});

export default router;