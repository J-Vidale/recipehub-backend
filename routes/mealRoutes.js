import express from "express";
import axios from "axios";

const router = express.Router();

// GET /api/meals?search=chicken
router.get("/", async (req, res) => {
  const { search } = req.query;

  if (!search) {
    return res.status(400).json({ message: "Please provide a search term." });
  }

  try {
    const response = await axios.get(
      `https://www.themealdb.com/api/json/v1/1/search.php?s=${search}`
    );

    const meals = response.data.meals || [];
    res.json(meals);
  } catch (error) {
    console.error("Error fetching from TheMealDB:", error.message);
    res.status(500).json({ message: "Failed to fetch meals." });
  }
});

export default router;
