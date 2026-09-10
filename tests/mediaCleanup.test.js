import { describe, it, expect, vi, afterEach } from "vitest";
import cloudinary from "../config/cloudinary.js";
import { destroyQuietly } from "../utils/media.js";

// cloudinary.uploader.destroy THROWS rather than returning a rejected
// promise when the credentials are missing - "Must supply api_key",
// verified against the real package. A synchronous throw happens before
// .catch() can be attached and before Promise.allSettled ever sees the
// value, so both shapes previously used to make this best-effort were no
// protection at all.
//
// What that meant in practice: with Cloudinary unset or misconfigured,
// deleting a recipe or changing an avatar failed outright - after the
// database change had already been written.

afterEach(() => vi.restoreAllMocks());

describe("best-effort media cleanup", () => {
  it("survives a destroy that throws instead of rejecting", async () => {
    // This is the real failure shape, not a rejected promise.
    vi.spyOn(cloudinary.uploader, "destroy").mockImplementation(() => {
      throw new Error("Must supply api_key");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(destroyQuietly("p1", "image")).resolves.toBe(false);
  });

  it("survives a destroy that rejects", async () => {
    vi.spyOn(cloudinary.uploader, "destroy").mockRejectedValue(new Error("network"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(destroyQuietly("p1", "image")).resolves.toBe(false);
  });

  it("says so in the log, because it leaves an asset behind", async () => {
    vi.spyOn(cloudinary.uploader, "destroy").mockRejectedValue(new Error("network"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await destroyQuietly("p1", "image");
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("p1"));
  });

  it("reports success when the asset is gone", async () => {
    const destroy = vi.spyOn(cloudinary.uploader, "destroy").mockResolvedValue({ result: "ok" });
    await expect(destroyQuietly("p1", "video")).resolves.toBe(true);
    expect(destroy).toHaveBeenCalledWith("p1", { resource_type: "video" });
  });

  it("does not call Cloudinary at all without a public id", async () => {
    const destroy = vi.spyOn(cloudinary.uploader, "destroy");
    await expect(destroyQuietly(null)).resolves.toBe(false);
    await expect(destroyQuietly(undefined)).resolves.toBe(false);
    await expect(destroyQuietly("")).resolves.toBe(false);
    expect(destroy).not.toHaveBeenCalled();
  });

  it("uses the app's configured client, not a fresh one", async () => {
    // A helper that imports the package directly is configured only if
    // something else imported config/cloudinary.js first, which is how it
    // quietly stops being configured.
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../utils/media.js", import.meta.url), "utf8");
    expect(source).toMatch(/from "\.\.\/config\/cloudinary\.js"/);
  });
});

describe("the upload rollback", () => {
  it("goes through destroyQuietly, not a bare .catch", async () => {
    // A throw from inside a catch block skips the response that follows
    // it, so the caller gets the error handler's generic 500 instead of
    // the one that says what actually went wrong.
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../controllers/mediaController.js", import.meta.url), "utf8");
    const rollback = source.slice(source.indexOf("Failed to save recipe after upload") - 700);
    expect(rollback).toMatch(/destroyQuietly\(uploadResult\.public_id/);
    expect(rollback).not.toMatch(/\.catch\(\(\) => \{\}\)/);
  });

  it("leaves the media controller's own delete to fail loudly", async () => {
    // Deleting one image from a recipe genuinely needs to know the asset
    // is gone; dropping the row while the file survives would be wrong.
    // That one is not best-effort and must not be quieted.
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../controllers/mediaController.js", import.meta.url), "utf8");
    const remove = source.slice(source.indexOf("export const deleteRecipeMedia"));
    expect(remove).toMatch(/cloudinary\.uploader\.destroy/);
    expect(remove).toMatch(/Failed to delete media from Cloudinary/);
  });
});
