import { describe, it, expect, vi, afterEach } from "vitest";
import Recipe from "../models/Recipe.js";
import User from "../models/User.js";
import { updateRecipe, deleteRecipe, unsaveRecipe } from "../controllers/recipeController.js";

// An id that is not an id reaches mongoose as a CastError, which Express 5
// forwards to the error handler as a 500. So a mistyped link, or a bot
// walking the URL space, came back as "the server is broken" and, with
// monitoring on, as an exception in the dashboard. It is a bad request.

const res = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

const user = { _id: "64f1c0de00000000000000a1" };

afterEach(() => vi.restoreAllMocks());

const JUNK = ["not-an-id", "", "123", "../../etc/passwd", "64f1c0de00000000000000a1x"];

describe("a recipe id that is not an id", () => {
  it.each(JUNK)("is refused by updateRecipe: %o", async (id) => {
    const find = vi.spyOn(Recipe, "findById");
    const r = res();
    await updateRecipe({ params: { id }, body: {}, user }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/invalid recipe id/i);
    expect(find, "the database was queried anyway").not.toHaveBeenCalled();
  });

  it.each(JUNK)("is refused by deleteRecipe: %o", async (id) => {
    const find = vi.spyOn(Recipe, "findById");
    const r = res();
    await deleteRecipe({ params: { id }, user }, r);
    expect(r.statusCode).toBe(400);
    expect(find).not.toHaveBeenCalled();
  });

  it.each(JUNK)("is refused by unsaveRecipe: %o", async (recipeId) => {
    const update = vi.spyOn(User, "updateOne");
    const r = res();
    await unsaveRecipe({ params: { recipeId }, user }, r);
    expect(r.statusCode).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("a well-formed id still gets through", () => {
  it("reaches the lookup, and a missing recipe is a 404 not a 400", async () => {
    vi.spyOn(Recipe, "findById").mockReturnValue({ lean: async () => null });
    const r = res();
    await deleteRecipe({ params: { id: "64f1c0de00000000000000ff" }, user }, r);
    expect(r.statusCode).toBe(404);
  });
});
