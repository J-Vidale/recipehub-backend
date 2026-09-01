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

// Applied to /api/categories. The suggest endpoint is public and fires on
// every keystroke of the category field, and each call runs a grouping
// aggregation - generous enough for real typing, low enough that it can't
// be used to hammer the database.
export const suggestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please slow down." },
});
