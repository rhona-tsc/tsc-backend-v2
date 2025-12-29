import jwt from "jsonwebtoken";

export default function requireAnyAuth(req, res, next) {
  const token =
    req.headers.token ||
    req.headers.authorization?.split(" ")[1] ||
    req.headers.Authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ success: false, message: "Unauthorized: missing token" });
  }

  // Try multiple secrets (add/remove based on what you use in your app)
  const secrets = [
    process.env.JWT_SECRET,
    process.env.MUSICIAN_JWT_SECRET,
    process.env.JWT_SECRET_KEY, // if you use this anywhere
  ].filter(Boolean);

  let decoded = null;
  for (const secret of secrets) {
    try {
      decoded = jwt.verify(token, secret);
      break;
    } catch (e) {
      // try next secret
    }
  }

  if (!decoded) {
    return res.status(401).json({ success: false, message: "Unauthorized: invalid token" });
  }

  req.user = decoded;
  next();
}