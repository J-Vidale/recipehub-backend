// controllers/searchController.js
import Recipe from "../models/Recipe.js";
import User from "../models/User.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

// Escape regex special characters so user input can't be used to build an
// unintended pattern (regex injection) or a catastrophically slow one (ReDoS).
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GET /api/search?q=<query>&limit=<n>
// A single combined lookup across recipes (by title) and users (by
// username) - the shape a navbar search box needs. Not deeply paginated;
// it returns the top `limit` matches of each kind, same as a real app's
// instant-search dropdown. Case-insensitive substring match.
export const search = async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) {
    return res.json({ recipes: [], users: [] });
  }
  if (q.length > 100) {
    return res.status(400).json({ message: "Search query is too long" });
  }

  let limit = parseInt(req.query.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) limit = DEFAULT_LIMIT;
  limit = Math.min(limit, MAX_LIMIT);

  const pattern = new RegExp(escapeRegex(q), "i");

  const [recipes, users] = await Promise.all([
    Recipe.find({ title: pattern })
      .sort({ _id: -1 })
      .limit(limit)
      .populate("user", "username avatarUrl")
      .lean(),
    User.find({ username: pattern })
      .select("username avatarUrl followerCount followingCount")
      .limit(limit)
      .lean(),
  ]);

  res.json({ recipes, users });
};
