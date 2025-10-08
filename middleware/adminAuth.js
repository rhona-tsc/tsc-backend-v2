import jwt from 'jsonwebtoken';

const adminAuth = async (req, res, next) => {
  console.log(`🔐 [${req._rid || 'no-rid'}] adminAuth entered`);

  // Accept Authorization: Bearer <token> or legacy token header
  const authHeader = req.headers.authorization || '';
  let token = req.headers.token || '';
  if (!token && typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    token = authHeader.slice(7).trim();
  }

  if (!token) {
    console.warn(`🚫 [${req._rid || 'no-rid'}] adminAuth fail: no token`);
    return res.status(401).json({ success: false, message: 'Not Authorized Login' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    if (req.user && req.user._id && !req.user.id) {
      req.user.id = req.user._id;
    }
    console.log(`✅ [${req._rid || 'no-rid'}] adminAuth ok for user: ${req.user?.id || req.user?._id || 'unknown'}`);
    next();
  } catch (error) {
    console.warn(`🚫 [${req._rid || 'no-rid'}] adminAuth fail: jwt error`, error?.message || error);
    return res.status(401).json({ success: false, message: error.message || 'Not Authorized Login' });
  }
};

export default adminAuth;