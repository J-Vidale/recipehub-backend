// Must stay the first import: it loads the environment and starts error
// monitoring before any other module is evaluated. See config/instrument.js.
import "./config/instrument.js";

import express from "express";
import http from "http";
import { Sentry, isMonitoringEnabled } from "./config/monitoring.js";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import mongoose from "mongoose";
import connectDB from "./config/db.js";
import { initSocket } from "./config/socket.js";
import userRoutes from "./routes/userRoutes.js";
import followRoutes from "./routes/followRoutes.js";
import recipeRoutes from "./routes/recipeRoutes.js";
import commentRoutes from "./routes/commentRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import searchRoutes from "./routes/searchRoutes.js";
import blockRoutes from "./routes/blockRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import tagRoutes from "./routes/tagRoutes.js";
import conversationRoutes from "./routes/conversationRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import mealRoutes from "./routes/mealRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import { authLimiter, writeLimiter } from "./middleware/rateLimiters.js";
import { notFound, errorHandler } from "./middleware/errorMiddleware.js";
import { allowedOrigins, corsOriginCheck } from "./config/origins.js";
import { buildHealthReport } from "./utils/health.js";
import { reportStartup } from "./utils/startupChecks.js";

connectDB();

const app = express();

// Middleware


// Render terminates TLS at its own proxy and forwards to this process, so
// without this every request carries the proxy's address and req.ip is
// identical for all clients. That made the auth rate limiter global rather
// than per-client: 20 failed logins from any one person locked out
// everybody. Trust exactly one hop - `true` would let a client spoof its
// own address through X-Forwarded-For.
app.set("trust proxy", 1);

app.use(helmet());
app.use(cors({
  origin: corsOriginCheck,
  credentials: true,
}));
app.use(compression());

// Before the body parsers on purpose: a request that is over its budget is
// refused without reading its body, so an abusive client cannot make the
// process buffer megabytes it is about to throw away. Reads are skipped
// inside the limiter, so ordinary browsing is untouched.
app.use(writeLimiter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// These four are public, read-only, and change rarely: the curated
// category list is a constant, popular tags and the meal proxy move
// slowly. Letting a browser and any CDN in front of it reuse a response
// for a few minutes removes most of their traffic. stale-while-revalidate
// means the next visitor gets the cached copy immediately while a fresh
// one is fetched behind them. Everything else stays uncached, because it
// is either per-user or written to.
const publicReadCache = (seconds) => (req, res, next) => {
  if (req.method !== "GET") return next();

  // The header has to be decided once the status is known. Setting it up
  // front cached failures too: a 429 from the rate limiter, or a 502 while
  // TheMealDB was down, would have been held by browsers and any shared
  // CDN for ten minutes - turning a blip into an outage. writeHead is the
  // last point before the response is committed.
  const originalWriteHead = res.writeHead;
  res.writeHead = function patchedWriteHead(...args) {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      res.setHeader(
        "Cache-Control",
        `public, max-age=${seconds}, stale-while-revalidate=${seconds * 2}`
      );
    }
    return originalWriteHead.apply(this, args);
  };

  next();
};

// Routes
app.use("/api/users", userRoutes);
app.use("/api/users", followRoutes);
app.use("/api/recipes", recipeRoutes);
app.use("/api/comments", commentRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/users", blockRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/tags", publicReadCache(300), tagRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/categories", publicReadCache(600), categoryRoutes);
app.use("/api/meals", publicReadCache(600), mealRoutes);
app.use("/api/auth", authLimiter, authRoutes);

// This service is API-only: the frontend is deployed separately as its own
// Render service. An earlier version tried to serve `frontend/dist` from
// here in production, but that directory does not exist in this repo, so
// every unmatched path (a mistyped API route included) hit sendFile and
// failed with ENOENT - returning a 500 and skipping the notFound handler
// below, which already produces the correct 404.
app.get("/", (req, res) => {
  // Deliberately always 200, and deliberately free of database work.
  //
  // This is the host's health check path and the target for any uptime
  // pinger, so it has to be cheap and it has to answer "is the web process
  // alive" rather than "is everything perfect". Returning 503 while the
  // database is briefly unreachable would make the platform restart a
  // process that is working fine, which cannot fix a database and turns a
  // blip into a restart loop.
  //
  // The database state is reported in the body instead: readyState is a
  // local integer the driver keeps up to date, so this costs no round
  // trip, and it is what tells you apart an API that is down from one that
  // is up but cannot reach Atlas.
  res.json(buildHealthReport(mongoose.connection.readyState, process.uptime()));
});

// Error handling. Sentry's handler observes the error first, then ours
// shapes the response - the client still gets the generic 500 message
// while the detail reaches the dashboard.
app.use(notFound);
if (isMonitoringEnabled()) {
  Sentry.setupExpressErrorHandler(app);
}
app.use(errorHandler);

// Server
const PORT = process.env.PORT || 5000;

// Socket.IO needs to attach to the raw HTTP server, not the Express app
// directly - app.listen() creates one internally but doesn't expose it.
const httpServer = http.createServer(app);
initSocket(httpServer, allowedOrigins);

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // Names any misconfigured variable while someone is still looking at
  // the deploy log, rather than leaving it to be found from the outside.
  reportStartup(process.env, allowedOrigins);
});
