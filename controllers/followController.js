// controllers/followController.js
import mongoose from "mongoose";
import User from "../models/User.js";
import Follow from "../models/Follow.js";

// POST /api/users/:id/follow
export const followUser = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid user ID" });
  }
  if (req.params.id === req.user._id.toString()) {
    return res.status(400).json({ message: "You cannot follow yourself" });
  }

  const targetUser = await User.findById(req.params.id);
  if (!targetUser) {
    return res.status(404).json({ message: "User not found" });
  }

  try {
    await Follow.create({ follower: req.user._id, following: targetUser._id });
    await User.updateOne({ _id: targetUser._id }, { $inc: { followerCount: 1 } });
    await User.updateOne({ _id: req.user._id }, { $inc: { followingCount: 1 } });
  } catch (err) {
    if (err.code !== 11000) {
      throw err;
    }
    // Already following - idempotent.
  }

  const updatedTarget = await User.findById(targetUser._id).select("followerCount");
  res.json({ followerCount: updatedTarget.followerCount, followingByMe: true });
};

// DELETE /api/users/:id/follow
export const unfollowUser = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid user ID" });
  }

  const targetUser = await User.findById(req.params.id);
  if (!targetUser) {
    return res.status(404).json({ message: "User not found" });
  }

  const deleted = await Follow.findOneAndDelete({
    follower: req.user._id,
    following: targetUser._id,
  });

  if (deleted) {
    await User.updateOne(
      { _id: targetUser._id, followerCount: { $gt: 0 } },
      { $inc: { followerCount: -1 } }
    );
    await User.updateOne(
      { _id: req.user._id, followingCount: { $gt: 0 } },
      { $inc: { followingCount: -1 } }
    );
  }

  const updatedTarget = await User.findById(targetUser._id).select("followerCount");
  res.json({ followerCount: updatedTarget.followerCount, followingByMe: false });
};

// GET /api/users/:id/followers
export const getFollowers = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid user ID" });
  }

  const targetUser = await User.findById(req.params.id);
  if (!targetUser) {
    return res.status(404).json({ message: "User not found" });
  }

  const follows = await Follow.find({ following: targetUser._id }).populate(
    "follower",
    "username"
  );
  res.json(follows.map((f) => f.follower));
};

// GET /api/users/:id/following
export const getFollowing = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid user ID" });
  }

  const targetUser = await User.findById(req.params.id);
  if (!targetUser) {
    return res.status(404).json({ message: "User not found" });
  }

  const follows = await Follow.find({ follower: targetUser._id }).populate(
    "following",
    "username"
  );
  res.json(follows.map((f) => f.following));
};
