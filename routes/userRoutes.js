// routes/userRoutes.js
import express from "express";
import { getMe, getUserProfile } from "../controllers/userController.js";
import { getBlockedUsers } from "../controllers/blockController.js";
import { protect, optionalAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/me", protect, getMe);
router.get("/blocked", protect, getBlockedUsers);
router.get("/:id", optionalAuth, getUserProfile);

export default router;
