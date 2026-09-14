// config/socket.js
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { mintedBeforePasswordChange } from "../utils/tokenFreshness.js";

let io = null;

// Attaches Socket.IO to the same HTTP server Express listens on - no
// separate port, no separate service. Each authenticated socket joins a
// room named after its user ID, so any other part of the app can push to
// a specific user with io.to(`user:${userId}`).emit(...) without needing
// to track socket IDs itself.
//
// Render's free tier sleeps the service after inactivity and drops every
// open connection when it does, with no client-side warning - so this is
// deliberately treated as a best-effort live-delivery layer, not a
// guaranteed one. socket.io's built-in reconnection handles the client
// side; polling (already in place for notifications) stays as the
// fallback that guarantees eventual consistency regardless of connection
// state.
// Who a handshake token belongs to, or a refusal.
//
// Lifted out of io.use so it can be exercised on its own: the handshake is
// the only place a socket's token is ever looked at, which makes it the
// one place a mistake here would not show up until someone was reading
// another person's messages.
export const authorizeSocket = async (token) => {
  if (!token) throw new Error("Not authorized, no token");

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new Error("Invalid token");
  }

  const user = await User.findById(decoded.id).select("_id passwordChangedAt").lean();
  if (!user) throw new Error("User not found");

  // The same rule protect() applies. Without it, changing a password
  // ended every HTTP session and left this one open: a stolen token still
  // opened a socket and kept receiving that person's messages and
  // notifications live, which is the opposite of what the change is for.
  if (mintedBeforePasswordChange(decoded, user)) {
    throw new Error("Session ended");
  }

  return user._id.toString();
};

export const initSocket = (httpServer, allowedOrigins) => {
  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      socket.userId = await authorizeSocket(socket.handshake.auth?.token);
      next();
    } catch (err) {
      next(err);
    }
  });

  io.on("connection", (socket) => {
    socket.join(`user:${socket.userId}`);
  });

  return io;
};

// Best-effort emit to a specific user's room. A no-op (never throws) if
// Socket.IO hasn't been initialized yet, or the user has no open sockets -
// callers should treat this exactly like the notification write itself:
// fire-and-forget, never load-bearing for the action that triggered it.
export const emitToUser = (userId, event, payload) => {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
};

// Closes every socket this user currently has open.
//
// Rejecting old tokens at the handshake only stops new connections. A
// socket opened before the password changed stays connected and keeps
// receiving, because the handshake is the only place its token is ever
// looked at. Changing a password says every other device has been signed
// out, so this is what makes that true of the live connection as well.
//
// Best-effort, like every other emit here: a no-op before Socket.IO is
// initialised, and never load-bearing for the action that called it.
export const disconnectUser = (userId) => {
  if (!io) return;
  io.in(`user:${userId}`).disconnectSockets(true);
};
