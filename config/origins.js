// Which origins the API will talk to.
//
// This was a hardcoded array, which meant attaching a custom domain broke
// the site in two places at once: the browser's CORS preflight and the
// Socket.IO handshake, both silently, with the frontend simply appearing
// to have no backend. Setting CORS_ORIGINS is now the only step needed.
//
// Format: a comma-separated list of full origins, e.g.
//   CORS_ORIGINS=https://recipehub.com,https://www.recipehub.com

const DEFAULT_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4173", // vite preview, used when checking a build locally
  "https://recipehub-frontend-cgip.onrender.com",
];

// Reduces anything URL-shaped to the origin a browser would actually send,
// or null if it is not one.
//
// An Origin header is scheme + host + port and nothing else, so a value
// that carries anything more can never match. Copying the address bar
// gives you a path ("https://site.com/explore"), copying from a dashboard
// gives you a trailing slash, and a hostname typed by hand can come out
// capitalised - all three used to be stored verbatim and silently refuse
// every request from the site they name. URL parsing settles all of them:
// it lowercases the host, drops the path, and drops a default port.
export const toOrigin = (value) => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    // A malformed entry is dropped rather than allowed through: a bad
    // value here would otherwise widen who can call the API.
    return null;
  }
};

export const parseOrigins = (raw) => {
  if (typeof raw !== "string" || !raw.trim()) return [...DEFAULT_ORIGINS];

  const parsed = [...new Set(raw.split(",").map(toOrigin).filter(Boolean))];

  // Falling back to the defaults on a completely unusable value is safer
  // than returning an empty list, which cors() treats as "reflect any
  // origin" - the opposite of what an operator setting this would want.
  return parsed.length > 0 ? parsed : [...DEFAULT_ORIGINS];
};

// Requests with no Origin header (server-to-server, curl, health checks)
// are allowed; the browser is the only thing CORS protects, and it always
// sends one.
export const createOriginCheck = (origins) => (origin, callback) => {
  if (!origin) return callback(null, true);
  const normalised = toOrigin(origin);
  // false, not an Error. Passing an Error makes cors() call next(err),
  // which reaches the error handler and returns a 500 "Server error" - and
  // with monitoring on, reports every bot probing with a foreign Origin as
  // an exception. Returning false simply omits the CORS headers, which is
  // what makes the browser block the response, which is the actual intent.
  callback(null, normalised !== null && origins.includes(normalised));
};

export const allowedOrigins = parseOrigins(process.env.CORS_ORIGINS);

export const corsOriginCheck = createOriginCheck(allowedOrigins);
