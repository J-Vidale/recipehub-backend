import { describe, it, expect, vi, afterEach } from "vitest";
import Recipe from "../models/Recipe.js";
import {
  createRecipe,
  updateRecipe,
  MAX_INGREDIENT_FIELD_LENGTH,
  MAX_INGREDIENTS,
} from "../controllers/recipeController.js";

// The title, instructions and category all had a ceiling. The ingredient
// list did not, so a recipe could carry a megabyte of ingredient text or a
// hundred thousand entries - stored once, then paid for by every reader of
// that recipe, and by the card grid that renders its name.

const res = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
});

const user = { _id: "64f1c0de00000000000000a1" };
const ok = { name: "olive oil", amount: "2 tbsp" };

afterEach(() => vi.restoreAllMocks());

describe("the ingredient list", () => {
  it("refuses a name longer than the limit", async () => {
    const create = vi.spyOn(Recipe, "create");
    const r = res();
    await createRecipe({
      body: { title: "Stew", instructions: "Cook.", ingredients: [{ name: "x".repeat(MAX_INGREDIENT_FIELD_LENGTH + 1), amount: "1" }] },
      user,
    }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(new RegExp(`${MAX_INGREDIENT_FIELD_LENGTH} characters`));
    expect(create, "the recipe was written anyway").not.toHaveBeenCalled();
  });

  it("refuses an amount longer than the limit", async () => {
    const create = vi.spyOn(Recipe, "create");
    const r = res();
    await createRecipe({
      body: { title: "Stew", instructions: "Cook.", ingredients: [{ name: "salt", amount: "x".repeat(MAX_INGREDIENT_FIELD_LENGTH + 1) }] },
      user,
    }, r);
    expect(r.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses more entries than a recipe could have", async () => {
    const create = vi.spyOn(Recipe, "create");
    const r = res();
    await createRecipe({
      body: { title: "Stew", instructions: "Cook.", ingredients: Array(MAX_INGREDIENTS + 1).fill(ok) },
      user,
    }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(new RegExp(`${MAX_INGREDIENTS} ingredients`));
    expect(create).not.toHaveBeenCalled();
  });

  it("accepts a list at exactly the limits", async () => {
    const create = vi.spyOn(Recipe, "create").mockResolvedValue({
      _id: "64f1c0de00000000000000b2",
      populate: async () => ({ _id: "64f1c0de00000000000000b2" }),
    });
    const r = res();
    await createRecipe({
      body: {
        title: "Stew",
        instructions: "Cook.",
        ingredients: Array(MAX_INGREDIENTS).fill({
          name: "x".repeat(MAX_INGREDIENT_FIELD_LENGTH),
          amount: "y".repeat(MAX_INGREDIENT_FIELD_LENGTH),
        }),
      },
      user,
    }, r);
    expect(r.statusCode).not.toBe(400);
    expect(create).toHaveBeenCalled();
  });

  it("applies the same limits on edit, not only on create", async () => {
    const recipe = { _id: "64f1c0de00000000000000b2", user: { toString: () => user._id }, save: vi.fn() };
    vi.spyOn(Recipe, "findById").mockResolvedValue(recipe);
    const r = res();
    await updateRecipe({
      params: { id: "64f1c0de00000000000000b2" },
      body: { ingredients: [{ name: "x".repeat(MAX_INGREDIENT_FIELD_LENGTH + 1), amount: "1" }] },
      user,
    }, r);
    expect(r.statusCode).toBe(400);
    expect(recipe.save, "the edit was saved anyway").not.toHaveBeenCalled();
  });
});
