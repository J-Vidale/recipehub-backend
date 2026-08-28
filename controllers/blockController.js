// controllers/blockController.js
import mongoose from "mongoose";
import User from "../models/User.js";
import Block from "../models/Block.js";
import Follow from "../models/Follow.js";

// Blocking severs any existing follow relationship in either direction -
// matches how every major platform treats block (you can't follow someone
// who's blocked you, or someone you've blocked).
const removeFollowIfExists = async (followerId, followingId) => {
  const deleted = await Follow.findOneAndDelete({
    follower: followerId,
    following: followingId,
  }).lean();
  if (deleted) {
    await User.updateOne(
      { _id: followingId, followerCount: { $gt: 0 } },
      { $inc: { followerCount: -1 } }
    );
    await User.updateOne(
      { _id: followerId, followingCount: { $gt: 0 } },
      { $inc: { followingCount: -1 } }
    );
  }
};

// POST /api/users/:id/block
export const blockUser = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid user ID" });
  }
  if (req.params.id === req.user._id.toString()) {
    return res.status(400).json({ message: "You cannot block yourself" });
  }

  const targetUser = await User.findById(req.params.id).lean();
  if (!targetUser) {
    return res.status(404).json({ message: "User not found" });
  }

  try {
    await Block.create({ blocker: req.user._id, blocked: targetUser._id });
  } catch (err) {
    if (err.code !== 11000) {
      throw err;
    }
    // Already blocked - idempotent.
  }

  await removeFollowIfExists(req.user._id, targetUser._id);
  await removeFollowIfExists(targetUser._id, req.user._id);

  res.json({ blocked: true });
};

// DELETE /api/users/:id/block
export const unblockUser = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid user ID" });
  }

  await Block.deleteOne({ blocker: req.user._id, blocked: req.params.id });
  res.json({ blocked: false });
};

// GET /api/users/blocked
export const getBlockedUsers = async (req, res) => {
  const blocks = await Block.find({ blocker: req.user._id })
    .sort({ _id: -1 })
    .populate("blocked", "username")
    .lean();
  res.json(blocks.map((b) => b.blocked));
};
