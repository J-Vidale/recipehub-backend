// controllers/followController.js
import mongoose from "mongoose";
import User from "../models/User.js";
import Follow from "../models/Follow.js";
import { createNotification } from "../utils/notify.js";

// POST /api/users/:id/follow
export const followUser = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid user ID" });
  }
  if (req.params.id === req.user._id.toString()) {
    return res.status(400).json({ message: "You cannot follow yourself" });
  }

  const targetUser = await User.findById(req.params.id).lean();
  if (!targetUser) {
    return res.status(404).json({ message: "User not found" });
  }

  let created = true;
  try {
    await Follow.create({ follower: req.user._id, following: targetUser._id });
    await User.updateOne({ _id: targetUser._id }, { $inc: { followerCount: 1 } });
    await User.updateOne({ _id: req.user._id }, { $inc: { followingCount: 1 } });
  } catch (err) {
    if (err.code !== 11000) {
      throw err;
    }
    // Already following - idempotent.
    created = false;
  }

  if (created) {
    createNotification({
      recipient: targetUser._id,
      actor: req.user._id,
      type: "follow",
    });
  }

  const updatedTarget = await User.findById(targetUser._id).select("followerCount").lean();
  res.json({ followerCount: updatedTarget.followerCount, followingByMe: true });
};

// DELETE /api/users/:id/follow
export const unfollowUser = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid user ID" });
  }

  const targetUser = await User.findById(req.params.id).lean();
  if (!targetUser) {
    return res.status(404).json({ message: "User not found" });
  }

  const deleted = await Follow.findOneAndDelete({
    follower: req.user._id,
    following: targetUser._id,
  }).lean();

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

  const updatedTarget = await User.findById(targetUser._id).select("followerCount").lean();
  res.json({ followerCount: updatedTarget.followerCount, followingByMe: false });
};

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;

const parseListLimit = (query) => {
  let limit = parseInt(query.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) limit = DEFAULT_LIST_LIMIT;
  return Math.min(limit, MAX_LIST_LIMIT);
};

// GET /api/users/:id/followers
export const getFollowers = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid user ID" });
  }

  const targetUser = await User.findById(req.params.id).lean();
  if (!targetUser) {
    return res.status(404).json({ message: "User not found" });
  }

  const limit = parseListLimit(req.query);
  const follows = await Follow.find({ following: targetUser._id })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("follower", "username")
    .lean();
  res.json(follows.map((f) => f.follower));
};

// GET /api/users/:id/following
export const getFollowing = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid user ID" });
  }

  const targetUser = await User.findById(req.params.id).lean();
  if (!targetUser) {
    return res.status(404).json({ message: "User not found" });
  }

  const limit = parseListLimit(req.query);
  const follows = await Follow.find({ follower: targetUser._id })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("following", "username")
    .lean();
  res.json(follows.map((f) => f.following));
};
