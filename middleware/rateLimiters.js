// middleware/rateLimiters.js
import rateLimit from "express-rate-limit";

// Applied to /api/auth - login/register are the endpoints most worth
// protecting against brute-force/credential-stuffing attempts.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts, please try again later." },
});
