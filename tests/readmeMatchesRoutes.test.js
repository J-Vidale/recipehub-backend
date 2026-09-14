import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";

// The README's endpoint list is the API's contract - it is what anyone
// building against this reads, and nothing else would notice when it
// stopped being true. Changing a password and deleting an account both
// shipped without a line in it, and the reports section still said there
// was no way to moderate anything long after the queue existed.
//
// This walks the routes the app actually mounts and insists each one is
// written down. It cannot tell whether the description is accurate; it can
// tell whether the endpoint is mentioned at all, which is the half that
// goes wrong silently.

const root = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

let readme;
let mounted;

beforeAll(async () => {
  readme = await read("README.md");
  const server = await read("server.js");

  const importedFrom = Object.fromEntries(
    [...server.matchAll(/import (\w+Routes) from "(\.\/routes\/[^"]+)"/g)].map(
      ([, name, path]) => [name, path]
    )
  );

  mounted = new Set();
  // app.use("/api/x", router), with any middleware in between - the auth
  // and cache-header routes have some.
  for (const [, mount, name] of server.matchAll(
    /app\.use\("(\/api\/[^"]+)",\s*(?:[\w()\s,]*?\s)?(\w+Routes)\)/g
  )) {
    const { default: router } = await import(new URL(importedFrom[name], root).pathname);
    for (const layer of router.stack) {
      if (!layer.route) continue;
      // router.route("/:id").get().put().delete() is one route carrying
      // three methods, each handler tagged with the method it belongs to.
      const methods = new Set(layer.route.stack.map((handler) => handler.method).filter(Boolean));
      for (const method of methods) {
        mounted.add(`${method.toUpperCase()} ${(mount + layer.route.path).replace(/\/$/, "") || mount}`);
      }
    }
  }
});

describe("the README's endpoint list", () => {
  it("mentions every route the app mounts", () => {
    // Guards the walk above: an empty set would pass vacuously.
    expect(mounted.size).toBeGreaterThan(40);
    expect(mounted.has("POST /api/auth/login")).toBe(true);

    const undocumented = [...mounted].filter((entry) => {
      const [method, path] = entry.split(" ");
      // Written as `METHOD /path`, sometimes with a query string appended:
      // `GET /api/notifications?cursor=<id>`.
      return !new RegExp("`" + method + " " + path.replace(/[:?]/g, "\\$&") + "[`?\\s]").test(readme);
    });

    expect(undocumented, `not written down in README.md: ${undocumented.join(", ")}`).toEqual([]);
  });

  it("does not still claim reports cannot be acted on", () => {
    // The queue exists. This sentence outlived it by long enough to be
    // worth a test of its own.
    expect(readme).not.toMatch(/no admin\/moderation dashboard yet/i);
    expect(readme).toMatch(/ADMIN_USERNAMES/);
  });
});
