import mongoose from 'mongoose';
import streamifier from 'streamifier';
import User from '../models/User.js';
import Recipe from '../models/Recipe.js';
import Follow from '../models/Follow.js';
import cloudinary from '../config/cloudinary.js';
import { ALLOWED_MIME_TYPES, MAX_IMAGE_BYTES } from '../middleware/uploadMiddleware.js';

// Get logged-in user info
export const getMe = async (req, res) => {
  // `protect` has already loaded this exact document (the caller's, minus
  // the password) for this request, so re-querying here bought nothing and
  // cost correctness: it looked up `req.user.id`, which is undefined on a
  // lean document - only `_id` survives lean(). Mongoose 8 turns
  // findById(undefined) into an empty filter, so the query became
  // findOne({}) and returned whichever user happened to be first in the
  // collection, to every caller.
  res.json(req.user);
};

// GET /api/users/:id — public profile
export const getUserProfile = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: 'Invalid user ID' });
  }

  const user = await User.findById(req.params.id)
    .select('username avatarUrl followerCount followingCount createdAt')
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
    avatarUrl: user.avatarUrl,
    followerCount: user.followerCount,
    followingCount: user.followingCount,
    recipeCount,
    followingByMe: Boolean(followingByMe),
    createdAt: user.createdAt,
  });
};

const uploadBufferToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'image',
        folder: 'recipehub/avatars',
        // Square crop centered on the face where detectable, capped at a
        // sensible display size - an avatar never needs to be full-res.
        transformation: [
          { width: 400, height: 400, crop: 'fill', gravity: 'auto' },
          { fetch_format: 'auto', quality: 'auto' },
        ],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

// POST /api/users/me/avatar
export const uploadAvatar = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  const mediaType = ALLOWED_MIME_TYPES[req.file.mimetype];
  if (mediaType !== 'image') {
    return res.status(400).json({ message: 'Avatar must be an image' });
  }
  if (req.file.size > MAX_IMAGE_BYTES) {
    return res.status(400).json({ message: 'Image exceeds 8MB limit' });
  }

  let uploadResult;
  try {
    uploadResult = await uploadBufferToCloudinary(req.file.buffer);
  } catch (err) {
    return res.status(502).json({
      message: 'Avatar upload failed',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }

  const user = await User.findById(req.user._id);
  // Read the previous id from the freshly loaded document, not from the
  // req.user snapshot taken when the request was authenticated: two
  // avatar uploads in flight at once would otherwise both see the
  // original id and leave the loser's Cloudinary asset orphaned.
  const previousPublicId = user.avatarPublicId;
  user.avatarUrl = uploadResult.secure_url;
  user.avatarPublicId = uploadResult.public_id;
  await user.save();

  if (previousPublicId) {
    await cloudinary.uploader.destroy(previousPublicId, { resource_type: 'image' }).catch(() => {});
  }

  res.json({ avatarUrl: user.avatarUrl });
};

// DELETE /api/users/me/avatar
export const deleteAvatar = async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user.avatarUrl) {
    return res.status(400).json({ message: 'No avatar to remove' });
  }

  const publicId = user.avatarPublicId;
  user.avatarUrl = null;
  user.avatarPublicId = null;
  await user.save();

  if (publicId) {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image' }).catch(() => {});
  }

  res.json({ avatarUrl: null });
};
