import mongoose from "mongoose";

// Connects to MongoDB, and keeps trying if it cannot.
//
// This used to call process.exit(1) the first time a connection failed,
// which turned every database misconfiguration into a dead web process: no
// health endpoint, no logs after the first line, and the site's own
// connection diagnostics reporting "API unreachable" - pointing at the
// frontend's API URL, the one thing that was actually correct. A wrong
// password looked identical to a wrong hostname looked identical to a
// service that had never started.
//
// Staying up instead keeps the health endpoint answering with
// database: "disconnected", which is what names the real problem. Mongoose
// queues queries while the connection is down and replays them once it
// lands, so a request arriving mid-retry waits rather than failing.

const FIRST_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;

const connectDB = async (delay = FIRST_RETRY_MS) => {
  if (!process.env.MONGO_URI) {
    // Nothing to retry towards: a missing variable will not appear on its
    // own. The startup warnings say what to set.
    console.error("MONGO_URI is not set. Not attempting a database connection.");
    return;
  }

  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    // The message only, never the URI: it carries the database password.
    console.error(
      `MongoDB connection failed: ${error.message}. Retrying in ${Math.round(delay / 1000)}s.`
    );
    const timer = setTimeout(() => connectDB(Math.min(delay * 2, MAX_RETRY_MS)), delay);
    // A pending retry must not be the reason the process stays alive; the
    // HTTP server already is.
    timer.unref?.();
  }
};

export default connectDB;
