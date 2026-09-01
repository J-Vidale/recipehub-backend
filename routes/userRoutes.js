// routes/userRoutes.js
import express from "express";
import { getMe, getUserProfile, uploadAvatar, deleteAvatar } from "../controllers/userController.js";
import { getBlockedUsers } from "../controllers/blockController.js";
import { protect, optionalAuth } from "../middleware/authMiddleware.js";
import { uploadSingleImage } from "../middleware/uploadMiddleware.js";

const router = express.Router();

router.get("/me", protect, getMe);
router.post("/me/avatar", protect, uploadSingleImage, uploadAvatar);
router.delete("/me/avatar", protect, deleteAvatar);
router.get("/blocked", protect, getBlockedUsers);
router.get("/:id", optionalAuth, getUserProfile);

export default router;
