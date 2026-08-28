import express from "express";
import { blockUser, unblockUser } from "../controllers/blockController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/:id/block", protect, blockUser);
router.delete("/:id/block", protect, unblockUser);

export default router;
