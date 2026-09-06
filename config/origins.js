// Which origins the API will talk to.
//
// This was a hardcoded array, which meant attaching a custom domain broke
// the site in two places at once: the browser's CORS preflight and the
// Socket.IO handshake, both silently, with the frontend simply appearing
// to have no backend. Setting CORS_ORIGINS is now the only step needed.
//
// Format: a comma-separated list of full origins, e.g.
//   CORS_ORIGINS=https://recipehub.com,https://www.recipehub.com
// Trailing slashes and stray whitespace are tolerated because they are
// the two things everyone gets wrong when pasting a URL into a dashboard.

const DEFAULT_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4173", // vite preview, used when checking a build locally
  "https://recipehub-frontend-cgip.onrender.com",
];

const normalise = (value) => value.trim().replace(/\/+$/, "");

export const parseOrigins = (raw) => {
  if (typeof raw !== "string" || !raw.trim()) return [...DEFAULT_ORIGINS];

  const parsed = raw
    .split(",")
    .map(normalise)
    .filter(Boolean)
    // A malformed entry is dropped rather than allowed through: a bad
    // value here would otherwise widen who can call the API.
    .filter((origin) => {
      try {
        const url = new URL(origin);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    });

  // Falling back to the defaults on a completely unusable value is safer
  // than returning an empty list, which cors() treats as "reflect any
  // origin" - the opposite of what an operator setting this would want.
  return parsed.length > 0 ? parsed : [...DEFAULT_ORIGINS];
};

export const allowedOrigins = parseOrigins(process.env.CORS_ORIGINS);

// Requests with no Origin header (server-to-server, curl, health checks)
// are allowed; the browser is the only thing CORS protects, and it always
// sends one.
export const corsOriginCheck = (origin, callback) => {
  if (!origin || allowedOrigins.includes(normalise(origin))) {
    return callback(null, true);
  }
  callback(new Error(`Origin ${origin} is not allowed`));
};
