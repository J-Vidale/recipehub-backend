import * as Sentry from "@sentry/node";

// Error reporting, off unless SENTRY_DSN is set.
//
// Without this a 500 in production is invisible: the client sees a generic
// message (deliberately - errorMiddleware stops driver internals reaching
// it) and nothing is left anywhere to say what happened. That trade only
// works if the detail goes somewhere, which is here.
//
// Everything below is a no-op when the DSN is absent, so local runs, CI
// and a deploy where nobody has set it up all behave exactly as before.

export const isMonitoringEnabled = () => Boolean(process.env.SENTRY_DSN);

// Split out from initMonitoring so the scrubbing rules can be tested
// directly. ES module namespaces are not configurable, so spying on
// Sentry.init to read them back is not an option, and a pure function is
// a better seam than a mock anyway.
export const buildSentryOptions = () => ({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",

  // Performance tracing is sampled rather than complete: the free tier is
  // quota-limited and a busy endpoint would burn through it in a day.
  // Errors are always sent; only traces are sampled.
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),

  // The API handles private messages, email addresses and auth tokens.
  // None of that should leave the server to a third party, so request
  // bodies, headers and cookies are not attached.
  sendDefaultPii: false,

  beforeSend(event) {
    // Belt and braces: strip anything that could carry a credential even
    // if a future SDK default starts including it.
    if (event.request) {
      delete event.request.cookies;
      delete event.request.data;
      if (event.request.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
    }
    return event;
  },
});

export const initMonitoring = () => {
  if (!isMonitoringEnabled()) return false;
  Sentry.init(buildSentryOptions());
  return true;
};

// Reports an error that has already been handled, so it is visible without
// being re-thrown at the client.
export const captureError = (error, context = {}) => {
  if (!isMonitoringEnabled()) return;
  Sentry.captureException(error, { extra: context });
};

export { Sentry };
