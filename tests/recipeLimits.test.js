import { describe, it, expect, vi, afterEach } from "vitest";
import Recipe from "../models/Recipe.js";
import {
  createRecipe,
  MAX_TITLE_LENGTH,
  MAX_INSTRUCTIONS_LENGTH,
} from "../controllers/recipeController.js";

// Recipes were the last free text with no ceiling on it: comments cap at
// 1000 characters and messages at 2000, but a title could be a hundred
// kilobytes, and a title that was not a string reached mongoose's cast and
// came back as a 500 rather than the field error it is.

const call = async (body) => {
  const res = {
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
  };
  await createRecipe({ body, user: { _id: "64f1c0de00000000000000a1" } }, res);
  return res;
};

const acceptCreate = () =>
  vi.spyOn(Recipe, "create").mockImplementation(async (doc) => doc);

afterEach(() => vi.restoreAllMocks());

describe("the title", () => {
  it("is required", async () => {
    const create = acceptCreate();
    for (const title of [undefined, null, "", "   ", 42, {}, ["a"]]) {
      const res = await call({ title });
      expect(res.statusCode, `accepted ${JSON.stringify(title)}`).toBe(400);
      expect(res.body.message).toMatch(/Title is required/);
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("has a ceiling", async () => {
    acceptCreate();
    expect((await call({ title: "a".repeat(MAX_TITLE_LENGTH) })).statusCode).toBe(201);

    const res = await call({ title: "a".repeat(MAX_TITLE_LENGTH + 1) });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/cannot exceed 140/);
  });

  it("is stored trimmed", async () => {
    const create = acceptCreate();
    await call({ title: "  Roast chicken  " });
    expect(create.mock.calls[0][0].title).toBe("Roast chicken");
  });
});

describe("the instructions", () => {
  it("may be left out", async () => {
    const create = acceptCreate();
    const res = await call({ title: "Toast" });
    expect(res.statusCode).toBe(201);
    expect(create.mock.calls[0][0].instructions).toBe("");
  });

  it("must be text when given", async () => {
    acceptCreate();
    const res = await call({ title: "Toast", instructions: { $ne: null } });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/must be text/);
  });

  it("has a ceiling", async () => {
    acceptCreate();
    const res = await call({
      title: "Toast",
      instructions: "a".repeat(MAX_INSTRUCTIONS_LENGTH + 1),
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/cannot exceed 10000/);
  });

  it("still supplies the hashtags", async () => {
    const create = acceptCreate();
    await call({ title: "Toast", instructions: "Grill it #breakfast #quick" });
    expect(create.mock.calls[0][0].tags).toEqual(["breakfast", "quick"]);
  });
});

describe("multer's part limits", () => {
  it("are set on both upload paths", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../middleware/uploadMiddleware.js", import.meta.url),
      "utf8"
    );
    const multerCalls = source.match(/multer\(\{[\s\S]*?\}\)/g) ?? [];
    expect(multerCalls.length).toBe(2);
    for (const call of multerCalls) expect(call).toMatch(/limits: PART_LIMITS/);
  });
});
