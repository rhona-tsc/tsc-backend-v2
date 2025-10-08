// routes/authRoutes.js
import express from "express";
import jwt from "jsonwebtoken";
import musicianModel from "../models/musicianModel.js";

const router = express.Router();

router.post("/refresh", async (req, res) => {
    const refreshToken = req.cookies?.refreshToken;
    console.log("🔍 Refresh route hit. Cookie received:", refreshToken);
  
    if (!refreshToken) {
      console.warn("⚠️ No refresh token in cookie");
      return res.status(401).json({ success: false, message: "No refresh token" });
    }
  
    jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, async (err, decoded) => {
      if (err) {
        console.error("❌ Refresh token verification failed:", err.message);
        return res.status(403).json({ success: false, message: "Invalid refresh token" });
      }
  
      const user = await musicianModel.findById(decoded.id);
      if (!user) {
        console.error("❌ User not found for refresh token:", decoded.id);
        return res.status(404).json({ success: false, message: "User not found" });
      }
  
      const newAccessToken = jwt.sign(
        { id: user._id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: "15m" }
      );
  
      console.log("✅ Refresh success. New token generated for:", user.email);
      return res.json({ success: true, token: newAccessToken });
    });
  });

router.post("/logout", (req, res) => {
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: false, // in dev      sameSite: "Strict",
    });
    res.json({ success: true, message: "Logged out successfully" });
  });

export default router;