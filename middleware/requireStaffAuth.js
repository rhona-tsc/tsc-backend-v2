import jwt from "jsonwebtoken";

// Finance and maintenance tools are staff-only, not just any signed-in user.
export default function requireStaffAuth(req, res, next) {
  const bearer = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  const token = bearer?.[1] || req.headers.token;
  if (!token) return res.status(401).json({ success: false, message: "Please sign in." });
  if (!process.env.JWT_SECRET) {
    return res.status(503).json({ success: false, message: "Authentication unavailable." });
  }
  let user;
  try {
    user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
  } catch {
    return res.status(401).json({ success: false, message: "Please sign in again." });
  }
  const staffEmails = new Set([
    "hello@thesupremecollective.co.uk",
    String(process.env.AGENT_EMAIL || "").trim().toLowerCase(),
  ].filter(Boolean));
  if (user?.role !== "agent" || !staffEmails.has(String(user.email || "").trim().toLowerCase())) {
    return res.status(403).json({ success: false, message: "Staff access required." });
  }
  req.user = user;
  next();
}
