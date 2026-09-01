// controllers/categoryController.js
import Recipe from "../models/Recipe.js";
import { containsBlockedLanguage } from "../utils/moderateText.js";

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

const CATEGORIES_LOWER = CATEGORIES.map((c) => c.toLowerCase());

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
        // $min rather than $first: without a preceding $sort, $first picks
        // whichever document the group happened to see first, so the
        // displayed casing of the same category would drift between
        // requests. $min is stable for a given set of documents.
        name: { $min: "$category" },
        count: { $sum: 1 },
      },
    },
    // Curated names are dropped here, before the limit, so they can't eat
    // the slots the community list is supposed to fill. Filtering these
    // out afterwards in JS meant a common query ("s") could return eight
    // curated groups and therefore an empty community list.
    { $match: { _id: { $nin: [null, "", ...CATEGORIES_LOWER] } } },
    // _id breaks ties so equally-used categories keep a stable order
    // rather than swapping places between requests.
    { $sort: { count: -1, _id: 1 } },
    { $limit: SUGGEST_LIMIT },
  ]);
  // These strings were stored by other users. Anything written before the
  // field was moderated - or that slipped through - would otherwise be
  // autocompleted to everyone, so they are re-checked on the way out.
  return rows
    .filter((c) => !containsBlockedLanguage(c.name))
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
