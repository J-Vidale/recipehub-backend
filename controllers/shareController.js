// controllers/shareController.js
import mongoose from "mongoose";
import Recipe from "../models/Recipe.js";
import Share from "../models/Share.js";
import { createNotification } from "../utils/notify.js";

// POST /api/recipes/:id/share
export const shareRecipe = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid recipe ID" });
  }

  const recipe = await Recipe.findById(req.params.id).lean();
  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }

  let created = true;
  try {
    await Share.create({ user: req.user._id, recipe: recipe._id });
    await Recipe.updateOne({ _id: recipe._id }, { $inc: { shareCount: 1 } });
  } catch (err) {
    if (err.code !== 11000) {
      throw err;
    }
    created = false; // Already shared - idempotent.
  }

  if (created) {
    createNotification({
      recipient: recipe.user,
      actor: req.user._id,
      type: "share",
      recipe: recipe._id,
    });
  }

  const updated = await Recipe.findById(recipe._id).select("shareCount").lean();
  res.json({ shareCount: updated.shareCount, sharedByMe: true });
};

// DELETE /api/recipes/:id/share
export const unshareRecipe = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid recipe ID" });
  }

  const recipe = await Recipe.findById(req.params.id).lean();
  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }

  const deleted = await Share.findOneAndDelete({
    user: req.user._id,
    recipe: recipe._id,
  }).lean();

  if (deleted) {
    await Recipe.updateOne(
      { _id: recipe._id, shareCount: { $gt: 0 } },
      { $inc: { shareCount: -1 } }
    );
  }

  const updated = await Recipe.findById(recipe._id).select("shareCount").lean();
  res.json({ shareCount: updated ? updated.shareCount : 0, sharedByMe: false });
};
