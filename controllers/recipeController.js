// controllers/recipeController.js
import Recipe from "../models/Recipe.js";
import User from "../models/User.js";
import Like from "../models/Like.js";
import Comment from "../models/Comment.js";
import CommentLike from "../models/CommentLike.js";
import Follow from "../models/Follow.js";
import Notification from "../models/Notification.js";
import Share from "../models/Share.js";
import mongoose from "mongoose";
import cloudinary from "../config/cloudinary.js";
import { parseHashtags } from "../utils/parseHashtags.js";
import { getCached, setCached } from "../utils/cache.js";

const DISCOVER_CACHE_TTL_SECONDS = 60;

const parsePagination = (query, defaultLimit = 20, maxLimit = 50) => {
  let page = parseInt(query.page, 10);
  if (!Number.isInteger(page) || page < 1) page = 1;

  let limit = parseInt(query.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) limit = defaultLimit;
  limit = Math.min(limit, maxLimit);

  return { page, limit, skip: (page - 1) * limit };
};

const validateIngredients = (ingredients) => {
  if (!Array.isArray(ingredients)) {
    return { error: "Ingredients must be an array" };
  }
  for (const item of ingredients) {
    if (
      !item ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      typeof item.amount !== "string" ||
      !item.amount.trim()
    ) {
      return { error: "Each ingredient needs a name and an amount" };
    }
  }
  return {
    cleaned: ingredients.map((item) => ({
      name: item.name.trim(),
      amount: item.amount.trim(),
    })),
  };
};

// POST /api/recipes
export const createRecipe = async (req, res) => {
  const { title, instructions, category, ingredients } = req.body;

  if (typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ message: "Title is required" });
  }

  let cleanIngredients = [];
  if (ingredients !== undefined) {
    const { error, cleaned } = validateIngredients(ingredients);
    if (error) {
      return res.status(400).json({ message: error });
    }
    cleanIngredients = cleaned;
  }

  const recipe = await Recipe.create({
    title: title.trim(),
    instructions,
    category,
    ingredients: cleanIngredients,
    tags: parseHashtags(instructions),
    user: req.user._id,
  });

  res.status(201).json(recipe);
};

// GET /api/recipes
export const getAllRecipes = async (req, res) => {
  const { page, limit, sort } = req.query;

  let parsedPage = parseInt(page, 10);
  if (!Number.isInteger(parsedPage) || parsedPage < 1) {
    parsedPage = 1;
  }

  let parsedLimit = parseInt(limit, 10);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
    parsedLimit = 20;
  }
  parsedLimit = Math.min(parsedLimit, 50);

  const skip = (parsedPage - 1) * parsedLimit;

  try {
    if (sort === "newest") {
      const recipes = await Recipe.find()
        .sort({ _id: -1 })
        .skip(skip)
        .limit(parsedLimit + 1)
        .populate("user", "username avatarUrl")
        .lean();

      const hasMore = recipes.length > parsedLimit;
      return res.json({
        recipes: hasMore ? recipes.slice(0, parsedLimit) : recipes,
        page: parsedPage,
        hasMore,
      });
    }

    const cacheKey = `discover:page=${parsedPage}:limit=${parsedLimit}`;
    const cached = await getCached(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const recipes = await Recipe.aggregate([
      {
        $addFields: {
          ageInHours: {
            $divide: [{ $subtract: [new Date(), "$createdAt"] }, 1000 * 60 * 60],
          },
        },
      },
      {
        $addFields: {
          trendingScore: {
            $divide: [
              {
                $add: [
                  { $multiply: ["$shareCount", 4] },
                  { $multiply: ["$saveCount", 3] },
                  { $multiply: ["$commentCount", 2] },
                  { $multiply: ["$likeCount", 1] },
                ],
              },
              { $pow: [{ $add: ["$ageInHours", 2] }, 1.5] },
            ],
          },
        },
      },
      { $sort: { trendingScore: -1, _id: -1 } },
      { $skip: skip },
      { $limit: parsedLimit + 1 },
    ]);

    const hasMore = recipes.length > parsedLimit;
    const page = hasMore ? recipes.slice(0, parsedLimit) : recipes;
    await Recipe.populate(page, { path: "user", select: "username avatarUrl" });

    const responseBody = { recipes: page, page: parsedPage, hasMore };
    setCached(cacheKey, responseBody, DISCOVER_CACHE_TTL_SECONDS);
    res.json(responseBody);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch recipes" });
  }
};

// GET /api/recipes/feed
export const getFollowingFeed = async (req, res) => {
  const { cursor, limit } = req.query;

  if (cursor !== undefined && !mongoose.Types.ObjectId.isValid(cursor)) {
    return res.status(400).json({ message: "Invalid cursor" });
  }

  let parsedLimit = parseInt(limit, 10);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
    parsedLimit = 20;
  }
  parsedLimit = Math.min(parsedLimit, 50);

  try {
    const followingIds = await Follow.find({ follower: req.user._id }).distinct("following");

    if (followingIds.length === 0) {
      return res.json({ recipes: [], nextCursor: null });
    }

    const query = { user: { $in: followingIds } };
    if (cursor) {
      query._id = { $lt: cursor };
    }

    const recipes = await Recipe.find(query)
      .sort({ _id: -1 })
      .limit(parsedLimit + 1)
      .populate("user", "username avatarUrl")
      .lean();

    const hasMore = recipes.length > parsedLimit;
    const page = hasMore ? recipes.slice(0, parsedLimit) : recipes;
    const nextCursor = hasMore ? page[page.length - 1]._id : null;

    res.json({ recipes: page, nextCursor });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch feed" });
  }
};

// GET /api/recipes/mine
export const getMyRecipes = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const recipes = await Recipe.find({ user: req.user._id })
    .sort({ _id: -1 })
    .skip(skip)
    .limit(limit + 1)
    .lean();

  const hasMore = recipes.length > limit;
  res.json({ recipes: hasMore ? recipes.slice(0, limit) : recipes, page, hasMore });
};

// GET /api/recipes/:id
export const getSingleRecipe = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid recipe ID" });
  }
  try {
    const recipe = await Recipe.findById(req.params.id).populate("user", "username avatarUrl").lean();
    if (!recipe) {
      return res.status(404).json({ message: "Recipe not found" });
    }
    res.json(recipe);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch recipe" });
  }
};

// PUT /api/recipes/:id
export const updateRecipe = async (req, res) => {
  const recipe = await Recipe.findById(req.params.id);

  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }

  if (recipe.user.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: "Not authorized" });
  }

  if (req.body.title !== undefined) recipe.title = req.body.title;
  if (req.body.instructions !== undefined) {
    recipe.instructions = req.body.instructions;
    recipe.tags = parseHashtags(req.body.instructions);
  }
  if (req.body.category !== undefined) recipe.category = req.body.category;

  if (req.body.ingredients !== undefined) {
    const { error, cleaned } = validateIngredients(req.body.ingredients);
    if (error) {
      return res.status(400).json({ message: error });
    }
    recipe.ingredients = cleaned;
  }

  const updated = await recipe.save();
  res.json(updated);
};

// DELETE /api/recipes/:id
export const deleteRecipe = async (req, res) => {
  try {
    const recipe = await Recipe.findById(req.params.id).lean();

    if (!recipe) {
      return res.status(404).json({ message: "Recipe not found" });
    }

    if (recipe.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }

    // Best-effort: a Cloudinary hiccup on one asset shouldn't block the
    // user from deleting their own recipe.
    await Promise.allSettled(
      recipe.media.map((item) =>
        cloudinary.uploader.destroy(item.publicId, {
          resource_type: item.type === "video" ? "video" : "image",
        })
      )
    );

    const commentIds = await Comment.find({ recipe: recipe._id }).distinct("_id");
    await CommentLike.deleteMany({ comment: { $in: commentIds } });
    await Like.deleteMany({ recipe: recipe._id });
    await Share.deleteMany({ recipe: recipe._id });
    await Comment.deleteMany({ recipe: recipe._id });
    await Notification.deleteMany({ recipe: recipe._id });
    await User.updateMany(
      { savedRecipes: recipe._id },
      { $pull: { savedRecipes: recipe._id } }
    );
    await Recipe.deleteOne({ _id: recipe._id });

    res.json({ message: "Recipe deleted" });
  } catch (err) {
    res.status(500).json({
      message: "Failed to delete recipe",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

// GET /api/recipes/user/:userId
export const getRecipesByUser = async (req, res) => {
  const { userId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ message: "Invalid user ID" });
  }
  const { page, limit, skip } = parsePagination(req.query);
  const recipes = await Recipe.find({ user: userId })
    .sort({ _id: -1 })
    .skip(skip)
    .limit(limit + 1)
    .lean();

  const hasMore = recipes.length > limit;
  res.json({ recipes: hasMore ? recipes.slice(0, limit) : recipes, page, hasMore });
};

// GET /api/recipes/tag/:tag
export const getRecipesByTag = async (req, res) => {
  const tag = req.params.tag.toLowerCase();
  const { page, limit, skip } = parsePagination(req.query);
  const recipes = await Recipe.find({ tags: tag })
    .sort({ _id: -1 })
    .skip(skip)
    .limit(limit + 1)
    .populate("user", "username avatarUrl")
    .lean();

  const hasMore = recipes.length > limit;
  res.json({ recipes: hasMore ? recipes.slice(0, limit) : recipes, page, hasMore, tag });
};

// GET /api/tags/popular
export const getPopularTags = async (req, res) => {
  let limit = parseInt(req.query.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) limit = 20;
  limit = Math.min(limit, 50);

  const tags = await Recipe.aggregate([
    { $match: { tags: { $exists: true, $ne: [] } } },
    { $unwind: "$tags" },
    { $group: { _id: "$tags", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
    { $project: { _id: 0, tag: "$_id", count: 1 } },
  ]);

  res.json({ tags });
};

// GET /api/recipes/saved
export const getSavedRecipes = async (req, res) => {
  try {
    // This assumes you have a "savedRecipes" field on the User model that is an array of Recipe IDs
    const user = await User.findById(req.user._id).populate("savedRecipes").lean();
    res.json(user.savedRecipes || []);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch saved recipes" });
  }
};

// Save a recipe
export const saveRecipe = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.recipeId)) {
    return res.status(400).json({ message: "Invalid recipe ID" });
  }

  try {
    const recipeExists = await Recipe.exists({ _id: req.params.recipeId });
    if (!recipeExists) {
      return res.status(404).json({ message: "Recipe not found" });
    }

    const result = await User.updateOne(
      { _id: req.user._id },
      { $addToSet: { savedRecipes: req.params.recipeId } }
    );
    if (result.modifiedCount > 0) {
      await Recipe.updateOne(
        { _id: req.params.recipeId },
        { $inc: { saveCount: 1 } }
      );
    }
    res.json({ message: "Recipe saved" });
  } catch (err) {
    res.status(500).json({ message: "Failed to save recipe" });
  }
};

// Unsave a recipe
export const unsaveRecipe = async (req, res) => {
  try {
    const result = await User.updateOne(
      { _id: req.user._id },
      { $pull: { savedRecipes: req.params.recipeId } }
    );
    if (result.modifiedCount > 0) {
      await Recipe.updateOne(
        { _id: req.params.recipeId, saveCount: { $gt: 0 } },
        { $inc: { saveCount: -1 } }
      );
    }
    res.json({ message: "Recipe unsaved" });
  } catch (err) {
    res.status(500).json({ message: "Failed to unsave recipe" });
  }
};
