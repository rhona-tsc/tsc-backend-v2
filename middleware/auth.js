import jwt from 'jsonwebtoken';/** Shared token extractor so logs stay consistent */

function extractToken(req) {
  const authHeader = req.headers.authorization || "";
  let token = req.headers.token || "";
  if (!token && typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    token = authHeader.slice(7).trim();
  }
  const source = req.headers.authorization ? "Authorization" : (req.headers.token ? "legacy token" : "none");
  return { token, source };
}


const authUser = async (req, res, next) => {
  console.log(`🔐 [${req._rid || 'no-rid'}] auth middleware entered`);

  const authHeader = req.headers.authorization || '';
  let token = req.headers.token || '';
  if (!token && typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    token = authHeader.slice(7).trim();
  }

  const source = req.headers.authorization ? 'Authorization' : (req.headers.token ? 'legacy token' : 'none');
  console.log(`   ↳ token source: ${source}`);
  console.log(`   ↳ token length: ${token ? token.length : 0}`);

  if (!token) {
    console.warn(`🚫 [${req._rid || 'no-rid'}] auth fail: no token`);
    return res.status(401).json({ success: false, message: 'Not Authorized Login Again' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded || {};
    if (req.user && req.user._id && !req.user.id) req.user.id = req.user._id; // normalize
    console.log(`✅ [${req._rid || 'no-rid'}] auth ok for user: ${req.user?.id || 'unknown'}`);
    return next();
  } catch (error) {
    console.warn(`🚫 [${req._rid || 'no-rid'}] auth fail: jwt error`, error?.message || error);
    return res.status(401).json({ success: false, message: 'Not Authorized Login Again' });
  }
};

/** 🟡 Optional auth (no 401 if missing/invalid; just proceeds as anonymous) */
export const optionalAuthUser = (req, _res, next) => {
  console.log(`🟡 [${req._rid || "no-rid"}] optionalAuth entered`);
  const { token, source } = extractToken(req);
  console.log(`   ↳ token source: ${source}`);
  console.log(`   ↳ token length: ${token ? token.length : 0}`);

  if (!token) return next(); // anonymous allowed

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded || {};
    if (req.user && req.user._id && !req.user.id) req.user.id = req.user._id; // normalize
    console.log(`✅ [${req._rid || "no-rid"}] optionalAuth user: ${req.user?.id || "unknown"}`);
  } catch (err) {
    console.warn(`⚠️ [${req._rid || "no-rid"}] optionalAuth token ignored:`, err?.message || err);
    // deliberately do NOT 401 — just treat as anonymous
    req.user = undefined;
  }
  return next();
};

export default authUser;