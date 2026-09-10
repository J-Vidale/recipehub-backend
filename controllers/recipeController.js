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
import { moderateShortText, MAX_CATEGORY_LENGTH } from "../utils/moderateText.js";
import { parseListQuery, parsePageQuery, withCursor, buildPage } from "../utils/pagination.js";

const DISCOVER_CACHE_TTL_SECONDS = 60;

// Kept as a thin alias so existing call sites read unchanged; the cursor
// handling lives in utils/pagination.js.
const parsePagination = (query, defaultLimit = 20, maxLimit = 50) =>
  parseListQuery(query, defaultLimit, maxLimit);

// Recipes were the only free text with no ceiling on it. A title could be
// a hundred kilobytes, and a non-string one reached mongoose's cast and
// came back as a 500 rather than the field error it is. Comments and
// messages already have limits; these bring recipes in line.
export const MAX_TITLE_LENGTH = 140;
export const MAX_INSTRUCTIONS_LENGTH = 10000;

const sanitizeTitle = (raw) => {
  if (typeof raw !== "string") return { error: "Title is required" };
  const title = raw.trim();
  if (!title) return { error: "Title is required" };
  if (title.length > MAX_TITLE_LENGTH) {
    return { error: `Title cannot exceed ${MAX_TITLE_LENGTH} characters` };
  }
  return { value: title };
};

const sanitizeInstructions = (raw) => {
  if (raw === undefined || raw === null) return { value: "" };
  if (typeof raw !== "string") return { error: "Instructions must be text" };
  if (raw.length > MAX_INSTRUCTIONS_LENGTH) {
    return {
      error: `Instructions cannot exceed ${MAX_INSTRUCTIONS_LENGTH} characters`,
    };
  }
  return { value: raw };
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

// A category may be picked from the curated/community suggestions or
// typed as a custom name (see GET /api/categories/suggest) - either way
// it's just a string, so it's moderated here rather than validated
// against a fixed list.
const sanitizeCategory = (rawCategory) => {
  if (rawCategory === undefined || rawCategory === null) {
    return { value: undefined };
  }
  if (typeof rawCategory !== "string") {
    return { error: "Category must be text" };
  }
  const trimmed = rawCategory.trim();
  if (!trimmed) {
    return { value: "" };
  }
  // Moderate the text as submitted. Truncating to MAX_CATEGORY_LENGTH
  // first made the length rule unreachable, so an over-long category was
  // silently cut mid-word instead of returning the 400 the client shows
  // as a field error.
  const moderationError = moderateShortText(trimmed);
  if (moderationError) {
    return { error: moderationError };
  }
  return { value: trimmed };
};

// A recipe id that is not an id at all.
//
// Mongoose throws a CastError on it, which Express 5 forwards to the error
// handler as a 500 - so a mistyped link, or a bot walking the URL space,
// came back as "the server is broken" and, with monitoring on, as an
// exception in the dashboard. It is a bad request, and it is worth saying
// so in the same words everywhere.
const invalidRecipeId = (id) => !mongoose.Types.ObjectId.isValid(id);

// POST /api/recipes
export const createRecipe = async (req, res) => {
  const { title, instructions, category, ingredients } = req.body;

  const { error: titleError, value: cleanTitle } = sanitizeTitle(title);
  if (titleError) {
    return res.status(400).json({ message: titleError });
  }

  const { error: instructionsError, value: cleanInstructions } =
    sanitizeInstructions(instructions);
  if (instructionsError) {
    return res.status(400).json({ message: instructionsError });
  }

  let cleanIngredients = [];
  if (ingredients !== undefined) {
    const { error, cleaned } = validateIngredients(ingredients);
    if (error) {
      return res.status(400).json({ message: error });
    }
    cleanIngredients = cleaned;
  }

  const { error: categoryError, value: cleanCategory } = sanitizeCategory(category);
  if (categoryError) {
    return res.status(400).json({ message: categoryError });
  }

  const recipe = await Recipe.create({
    title: cleanTitle,
    instructions: cleanInstructions,
    category: cleanCategory,
    ingredients: cleanIngredients,
    tags: parseHashtags(cleanInstructions),
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

  // The "newest" branch is ordered by _id and can use a cursor; the
  // discover branch below is a ranked, cached feed that cannot, so it
  // takes its skip from the page number only.
  // The "newest" branch is ordered by _id and pages by cursor. The
  // discover branch below is a ranked, cached feed whose order is not _id,
  // so it always pages by number: reusing one skip for both meant that
  // ?page=3&cursor=... returned page 1 and then cached it under page 3,
  // serving the wrong content to everyone for the cache's lifetime.
  const { cursor } = parseListQuery(req.query, parsedLimit, 50);
  const { skip: discoverSkip } = parsePageQuery(req.query, parsedLimit, 50);
  const newestSkip = cursor ? 0 : discoverSkip;

  try {
    if (sort === "newest") {
      const recipes = await Recipe.find(withCursor({}, cursor))
        .sort({ _id: -1 })
        .skip(newestSkip)
        .limit(parsedLimit + 1)
        .populate("user", "username avatarUrl")
        .lean();

      const { items, hasMore, nextCursor } = buildPage(recipes, parsedLimit);
      return res.json({ recipes: items, page: parsedPage, hasMore, nextCursor });
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
      { $skip: discoverSkip },
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
  const { page, limit, skip, cursor } = parsePagination(req.query);
  const recipes = await Recipe.find(withCursor({ user: req.user._id }, cursor))
    .sort({ _id: -1 })
    .skip(skip)
    .limit(limit + 1)
    .lean();

  const { items, hasMore, nextCursor } = buildPage(recipes, limit);
  res.json({ recipes: items, page, hasMore, nextCursor });
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
  if (invalidRecipeId(req.params.id)) {
    return res.status(400).json({ message: "Invalid recipe ID" });
  }

  const recipe = await Recipe.findById(req.params.id);

  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }

  if (recipe.user.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: "Not authorized" });
  }

  if (req.body.title !== undefined) {
    const { error, value } = sanitizeTitle(req.body.title);
    if (error) {
      return res.status(400).json({ message: error });
    }
    recipe.title = value;
  }

  if (req.body.instructions !== undefined) {
    const { error, value } = sanitizeInstructions(req.body.instructions);
    if (error) {
      return res.status(400).json({ message: error });
    }
    recipe.instructions = value;
    recipe.tags = parseHashtags(value);
  }
  if (req.body.category !== undefined) {
    const { error: categoryError, value: cleanCategory } = sanitizeCategory(req.body.category);
    if (categoryError) {
      return res.status(400).json({ message: categoryError });
    }
    recipe.category = cleanCategory;
  }

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
  if (invalidRecipeId(req.params.id)) {
    return res.status(400).json({ message: "Invalid recipe ID" });
  }

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
  const { page, limit, skip, cursor } = parsePagination(req.query);
  const recipes = await Recipe.find(withCursor({ user: userId }, cursor))
    .sort({ _id: -1 })
    .skip(skip)
    .limit(limit + 1)
    .lean();

  const { items, hasMore, nextCursor } = buildPage(recipes, limit);
  res.json({ recipes: items, page, hasMore, nextCursor });
};

// GET /api/recipes/tag/:tag
export const getRecipesByTag = async (req, res) => {
  const tag = req.params.tag.toLowerCase();
  const { page, limit, skip, cursor } = parsePagination(req.query);
  const recipes = await Recipe.find(withCursor({ tags: tag }, cursor))
    .sort({ _id: -1 })
    .skip(skip)
    .limit(limit + 1)
    .populate("user", "username avatarUrl")
    .lean();

  const { items, hasMore, nextCursor } = buildPage(recipes, limit);
  res.json({ recipes: items, page, hasMore, nextCursor, tag });
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
  if (invalidRecipeId(req.params.recipeId)) {
    return res.status(400).json({ message: "Invalid recipe ID" });
  }

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
