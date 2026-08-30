import express from "express";
import http from "http";
import dotenv from "dotenv";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
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
import { authLimiter } from "./middleware/rateLimiters.js";
import { notFound, errorHandler } from "./middleware/errorMiddleware.js";

dotenv.config();
connectDB();

const app = express();

// Middleware
const allowedOrigins = [
  "http://localhost:5173",
  "https://recipehub-frontend-cgip.onrender.com"
];

// Render terminates TLS at its own proxy and forwards to this process, so
// without this every request carries the proxy's address and req.ip is
// identical for all clients. That made the auth rate limiter global rather
// than per-client: 20 failed logins from any one person locked out
// everybody. Trust exactly one hop - `true` would let a client spoof its
// own address through X-Forwarded-For.
app.set("trust proxy", 1);

app.use(helmet());
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/api/users", userRoutes);
app.use("/api/users", followRoutes);
app.use("/api/recipes", recipeRoutes);
app.use("/api/comments", commentRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/users", blockRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/tags", tagRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/meals", mealRoutes);
app.use("/api/auth", authLimiter, authRoutes);

// This service is API-only: the frontend is deployed separately as its own
// Render service. An earlier version tried to serve `frontend/dist` from
// here in production, but that directory does not exist in this repo, so
// every unmatched path (a mistyped API route included) hit sendFile and
// failed with ENOENT - returning a 500 and skipping the notFound handler
// below, which already produces the correct 404.
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "recipehub-api" });
});

// Error handling
app.use(notFound);
app.use(errorHandler);

// Server
const PORT = process.env.PORT || 5000;

// Socket.IO needs to attach to the raw HTTP server, not the Express app
// directly - app.listen() creates one internally but doesn't expose it.
const httpServer = http.createServer(app);
initSocket(httpServer, allowedOrigins);

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
