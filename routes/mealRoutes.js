import express from "express";
import axios from "axios";

const router = express.Router();

// GET /api/meals?search=chicken
router.get("/", async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

  if (!search) {
    return res.status(400).json({ message: "Please provide a search term." });
  }
  if (search.length > 100) {
    return res.status(400).json({ message: "Search term is too long." });
  }

  try {
    // encodeURIComponent, not raw interpolation: an unescaped term could
    // otherwise append its own query parameters to the upstream request
    // ("chicken&c=Dessert") or walk the upstream path ("../lookup.php?i=1").
    const response = await axios.get(
      `https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(search)}`,
      { timeout: 5000 }
    );

    const meals = response.data.meals || [];
    res.json(meals);
  } catch (error) {
    console.error("Error fetching from TheMealDB:", error.message);
    if (error.code === "ECONNABORTED") {
      return res.status(504).json({ message: "TheMealDB took too long to respond." });
    }
    res.status(502).json({ message: "Failed to fetch meals." });
  }
});

export default router;
