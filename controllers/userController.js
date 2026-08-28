import mongoose from 'mongoose';
import User from '../models/User.js';
import Recipe from '../models/Recipe.js';
import Follow from '../models/Follow.js';

// Get logged-in user info
export const getMe = async (req, res) => {
  const user = await User.findById(req.user.id).select('-password').lean();
  res.json(user);
};

// GET /api/users/:id — public profile
export const getUserProfile = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: 'Invalid user ID' });
  }

  const user = await User.findById(req.params.id)
    .select('username followerCount followingCount createdAt')
    .lean();
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  const recipeCount = await Recipe.countDocuments({ user: user._id });

  let followingByMe = false;
  if (req.user && req.user._id.toString() !== user._id.toString()) {
    followingByMe = await Follow.exists({ follower: req.user._id, following: user._id });
  }

  res.json({
    _id: user._id,
    username: user.username,
    followerCount: user.followerCount,
    followingCount: user.followingCount,
    recipeCount,
    followingByMe: Boolean(followingByMe),
    createdAt: user.createdAt,
  });
};
