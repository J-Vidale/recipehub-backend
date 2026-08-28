// controllers/categoryController.js
import Recipe from "../models/Recipe.js";

export const CATEGORIES = [
  "Beef",
  "Chicken",
  "Dessert",
  "Lamb",
  "Pasta",
  "Pork",
  "Seafood",
  "Side",
  "Starter",
  "Vegan",
  "Vegetarian",
  "Breakfast",
  "Goat",
];

const CATEGORIES_LOWER = new Set(CATEGORIES.map((c) => c.toLowerCase()));

// Escape regex special characters so user input can't be used to build an
// unintended pattern (regex injection) or a catastrophically slow one (ReDoS).
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const MAX_QUERY_LENGTH = 60;
const SUGGEST_LIMIT = 8;

// Recipes actually tagged with a category matching `pattern`, grouped
// case-insensitively (so "chili" and "Chili" count as one), most-used
// first. Community categories that duplicate a curated one are excluded -
// those are already offered separately.
const communityMatches = async (matchStage) => {
  const rows = await Recipe.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: { $toLower: "$category" },
        name: { $first: "$category" },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: SUGGEST_LIMIT },
  ]);
  return rows
    .filter((c) => c._id && !CATEGORIES_LOWER.has(c._id))
    .map((c) => ({ name: c.name, count: c.count }));
};

// GET /api/categories - the full curated list. Used as the default
// browse set (e.g. the empty-query state of the autocomplete below).
export const getCategories = (req, res) => {
  res.json(CATEGORIES);
};

// GET /api/categories/suggest?q=<text>
// Cross-references the curated list with categories other users have
// actually used - the same way an address autocomplete narrows a list of
// real addresses as you type. A suggestion here is never *required*: the
// caller can still submit free text if nothing fits (recipeController
// moderates it for appropriateness, but doesn't validate it against this
// list).
export const suggestCategories = async (req, res) => {
  let q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q.length > MAX_QUERY_LENGTH) q = q.slice(0, MAX_QUERY_LENGTH);

  if (!q) {
    const community = await communityMatches({ category: { $nin: [null, ""] } });
    return res.json({ curated: CATEGORIES, community });
  }

  const pattern = new RegExp(escapeRegex(q), "i");
  const curated = CATEGORIES.filter((c) => pattern.test(c));
  const community = await communityMatches({ category: pattern });

  res.json({ curated, community });
};
