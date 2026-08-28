// config/socket.js
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

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
export const initSocket = (httpServer, allowedOrigins) => {
  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error("Not authorized, no token"));
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select("_id").lean();
      if (!user) {
        return next(new Error("User not found"));
      }
      socket.userId = user._id.toString();
      next();
    } catch (err) {
      next(new Error("Invalid token"));
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
