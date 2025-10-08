import jwt from 'jsonwebtoken';

const musicianAuth = async (req, res, next) => {
  console.log(`🔐 [${req._rid || 'no-rid'}] musicianAuth entered`);

  const authHeader = req.headers.authorization || '';
  let token = req.headers.token || '';
  if (!token && typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    token = authHeader.slice(7).trim();
  }

  const source = req.headers.authorization ? 'Authorization' : (req.headers.token ? 'legacy token' : 'none');
  console.log(`   ↳ token source: ${source}`);
  console.log(`   ↳ token length: ${token ? token.length : 0}`);

  if (!token) {
    console.warn(`🚫 [${req._rid || 'no-rid'}] musicianAuth fail: no token`);
    return res.status(401).json({ success: false, message: 'Not Authorized Login' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded || {};
    if (req.user && req.user._id && !req.user.id) req.user.id = req.user._id;
    console.log(`✅ [${req._rid || 'no-rid'}] musicianAuth ok for user: ${req.user?.id || 'unknown'}`);
    return next();
  } catch (error) {
    console.warn(`🚫 [${req._rid || 'no-rid'}] musicianAuth fail: jwt error`, error?.message || error);
    return res.status(401).json({ success: false, message: error.message || 'Not Authorized Login' });
  }
};

export default musicianAuth;