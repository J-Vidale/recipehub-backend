import express from "express";
import { likeComment, unlikeComment } from "../controllers/commentLikeController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/:commentId/like", protect, likeComment);
router.delete("/:commentId/like", protect, unlikeComment);

export default router;
