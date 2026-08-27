import express from "express";
import {
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
} from "../controllers/followController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/:id/follow", protect, followUser);
router.delete("/:id/follow", protect, unfollowUser);
router.get("/:id/followers", getFollowers);
router.get("/:id/following", getFollowing);

export default router;
