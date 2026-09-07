// What the log says when the API starts.
//
// Every deployment problem this app can have is a value in a dashboard
// field, and all of them fail the same way from the outside: the site loads
// and nothing works. The service's own log is the one place that can name
// which field, so it does - once, at startup, before anyone has to guess.
//
// Values are never printed, only names. Three of these variables are
// secrets and the log is visible to anyone who can open the dashboard.

const isSet = (value) => typeof value === "string" && value.trim() !== "";

// Atlas hands you the connection string with the password still written as
// a placeholder, and pasting it unchanged is the single most common way to
// get "bad auth" on a first deploy.
const PLACEHOLDER_PASSWORD = /<(db_)?password>/i;

const CLOUDINARY_KEYS = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

export const collectStartupWarnings = (env = process.env) => {
  const warnings = [];
  const production = env.NODE_ENV === "production";

  if (!isSet(env.MONGO_URI)) {
    warnings.push(
      "MONGO_URI is not set. Nothing that touches the database will work. It is the Atlas connection string from Connect -> Drivers."
    );
  } else if (PLACEHOLDER_PASSWORD.test(env.MONGO_URI)) {
    warnings.push(
      "MONGO_URI still contains the placeholder Atlas puts in the connection string. Replace it with the database user's password - that user's password, not the Atlas account one."
    );
  } else if (/^mongodb(\+srv)?:\/\/[^:/@]+:@/.test(env.MONGO_URI)) {
    warnings.push("MONGO_URI has a username but an empty password.");
  }

  if (!isSet(env.JWT_SECRET)) {
    warnings.push(
      "JWT_SECRET is not set. Registering and logging in will fail. Generate one with: openssl rand -base64 48"
    );
  } else if (env.JWT_SECRET.trim().length < 32) {
    warnings.push(
      "JWT_SECRET is shorter than 32 characters, which is short enough to be worth guessing. Generate one with: openssl rand -base64 48"
    );
  }

  const missingCloudinary = CLOUDINARY_KEYS.filter((key) => !isSet(env[key]));
  if (missingCloudinary.length > 0) {
    warnings.push(
      `Cloudinary is not fully configured (${missingCloudinary.join(", ")}). Recipe photos, videos and avatars will fail to upload; everything else works.`
    );
  }

  // Only in production. Locally the built-in list already covers the Vite
  // dev server and preview server, so warning would be noise every restart.
  if (production && !isSet(env.CORS_ORIGINS)) {
    warnings.push(
      "CORS_ORIGINS is not set, so only the built-in origins listed above are allowed. If the site is served from anything else the browser will refuse every response, which looks exactly like the API being down. Set it to the web client's origin and redeploy."
    );
  }

  return warnings;
};

export const summariseConfig = (env = process.env, origins = []) => [
  `Environment: ${env.NODE_ENV || "development"}`,
  `Allowed browser origins: ${origins.length > 0 ? origins.join(", ") : "(none)"}`,
  `Error monitoring: ${isSet(env.SENTRY_DSN) ? "on" : "off (SENTRY_DSN unset)"}`,
  `Cache: ${isSet(env.REDIS_URL) ? "Redis configured" : "off (REDIS_URL unset)"}`,
];

// Printed together so the ordering is fixed and the warnings cannot scroll
// away above the summary that explains them.
export const reportStartup = (env = process.env, origins = [], out = console) => {
  for (const line of summariseConfig(env, origins)) out.log(line);
  for (const warning of collectStartupWarnings(env)) out.warn(`WARNING: ${warning}`);
};
