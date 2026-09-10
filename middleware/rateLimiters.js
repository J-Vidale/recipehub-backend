// middleware/rateLimiters.js
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import jwt from "jsonwebtoken";

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

// Applied to /api/search. The writeLimiter below leaves reads alone
// because reads are cheap - but this one is not. A case-insensitive
// substring match cannot use an index, so every call scans the whole
// recipe and user collections, and the navbar fires one on every
// keystroke. That is the same shape as the category suggestions, and it
// gets the same budget: generous for real typing, low enough that it
// cannot be used to hold the database down.
export const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many searches, please slow down." },
});

// Everything that changes something.
//
// Only login and the category suggestions were limited, which left every
// write open: a script with one account could post recipes, comments and
// messages as fast as the network allowed, and a single upload loop could
// fill the Cloudinary quota in an afternoon. Reads are excluded - they are
// cheap, cacheable, and limiting them would throttle ordinary browsing.
//
// Keyed by account where there is one, so that everyone behind a shared
// address (a household, an office, a mobile carrier's NAT) gets their own
// budget instead of one between them. The token is verified here rather
// than trusted, because an unverified id is a header anyone can change to
// get a fresh bucket per request.
const writeKey = (req) => {
  const token = req.headers.authorization?.startsWith("Bearer")
    ? req.headers.authorization.split(" ")[1]
    : null;

  if (token) {
    try {
      const { id } = jwt.verify(token, process.env.JWT_SECRET);
      if (id) return `user:${id}`;
    } catch {
      // Invalid or expired: fall through and limit by address, same as a
      // logged-out caller. protect() is what rejects it.
    }
  }
  // Not req.ip directly: a single IPv6 client is handed a whole /64, so
  // per-address keys would be trivially sidestepped by using the next
  // address in it.
  return `ip:${ipKeyGenerator(req.ip)}`;
};

const readOnly = (req) =>
  req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS";

export const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: writeKey,
  skip: readOnly,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "You are doing that too quickly. Wait a moment and try again." },
});

// Uploads are the expensive write: each one holds a file in memory, then
// spends a Cloudinary transformation and storage quota that does not reset
// on its own. Well above what posting a recipe with a few photos needs.
export const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  keyGenerator: writeKey,
  skip: readOnly,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many uploads for now. Try again in a few minutes." },
});
