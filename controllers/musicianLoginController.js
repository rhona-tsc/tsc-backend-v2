import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import musicianLoginRouter from "./routes/musicianLoginRoute.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(cookieParser());

// Logging middleware wrapper for musician-login routes
const musicianLoginLoggingMiddleware = (req, res, next) => {
  console.log(`[Musician Login] ${req.method} ${req.originalUrl}`);
  next();
};

app.use(
  "/api/musician-login",
  musicianLoginLoggingMiddleware,
  musicianLoginRouter
);

// Main API mounts (clean)

// Removed duplicate mount of /api/musician-login as per instructions

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});