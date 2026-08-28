// controllers/mediaController.js
import mongoose from "mongoose";
import streamifier from "streamifier";
import Recipe from "../models/Recipe.js";
import cloudinary from "../config/cloudinary.js";
import {
  ALLOWED_MIME_TYPES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
} from "../middleware/uploadMiddleware.js";

const MAX_PHOTOS = 5;

const uploadBufferToCloudinary = (buffer, resourceType) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: resourceType,
        folder: "recipehub",
        // Bake automatic format (WebP/AVIF where supported) and quality
        // negotiation into the stored asset, so every consumer of
        // media.url gets an optimized delivery URL for free - no per-call
        // transformation string needed anywhere media is read.
        transformation: [{ fetch_format: "auto", quality: "auto" }],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

// Loads the recipe and checks ownership before any upload work happens, so
// a bad ID or an unauthorized request never costs a full file upload.
// Attaches the recipe to req.recipe for the next handler to reuse.
export const loadOwnedRecipe = async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid recipe ID" });
  }

  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }
  if (recipe.user.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: "Not authorized" });
  }

  req.recipe = recipe;
  next();
};

// POST /api/recipes/:id/media
export const addRecipeMedia = async (req, res) => {
  const recipe = req.recipe;

  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const mediaType = ALLOWED_MIME_TYPES[req.file.mimetype];
  if (!mediaType) {
    return res.status(400).json({ message: "Unsupported file type" });
  }
  if (mediaType === "image" && req.file.size > MAX_IMAGE_BYTES) {
    return res.status(400).json({ message: "Image exceeds 8MB limit" });
  }
  if (mediaType === "video" && req.file.size > MAX_VIDEO_BYTES) {
    return res.status(400).json({ message: "Video exceeds 50MB limit" });
  }

  const hasVideo = recipe.media.some((m) => m.type === "video");
  const photoCount = recipe.media.filter((m) => m.type === "image").length;

  if (mediaType === "video" && recipe.media.length > 0) {
    return res
      .status(400)
      .json({ message: "Cannot add a video to a recipe that already has media" });
  }
  if (mediaType === "image" && hasVideo) {
    return res
      .status(400)
      .json({ message: "Cannot add a photo to a recipe that already has a video" });
  }
  if (mediaType === "image" && photoCount >= MAX_PHOTOS) {
    return res
      .status(400)
      .json({ message: `Recipes can have at most ${MAX_PHOTOS} photos` });
  }

  const resourceType = mediaType === "video" ? "video" : "image";
  let uploadResult;
  try {
    uploadResult = await uploadBufferToCloudinary(req.file.buffer, resourceType);
  } catch (err) {
    return res.status(502).json({
      message: "Media upload failed",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }

  recipe.media.push({
    type: mediaType,
    url: uploadResult.secure_url,
    publicId: uploadResult.public_id,
    order: recipe.media.length,
  });

  try {
    const updated = await recipe.save();
    res.status(201).json(updated);
  } catch (err) {
    // The Cloudinary upload already succeeded - clean it up so it doesn't
    // linger as a billable, unreferenced asset.
    await cloudinary.uploader
      .destroy(uploadResult.public_id, { resource_type: resourceType })
      .catch(() => {});
    res.status(500).json({
      message: "Failed to save recipe after upload",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

// DELETE /api/recipes/:id/media/:mediaId
export const deleteRecipeMedia = async (req, res) => {
  const recipe = req.recipe;

  const mediaItem = recipe.media.id(req.params.mediaId);
  if (!mediaItem) {
    return res.status(404).json({ message: "Media not found" });
  }

  try {
    await cloudinary.uploader.destroy(mediaItem.publicId, {
      resource_type: mediaItem.type === "video" ? "video" : "image",
    });
  } catch (err) {
    return res.status(502).json({
      message: "Failed to delete media from Cloudinary",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }

  mediaItem.deleteOne();
  await recipe.save();
  res.json(recipe);
};
