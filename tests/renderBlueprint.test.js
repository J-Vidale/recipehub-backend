import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";

// The blueprint is only useful while it agrees with the code it deploys, and
// nothing else would notice if it stopped: a wrong start command or a
// missing variable shows up as a failed deploy weeks later, on someone
// else's evening. These are cheap text checks, not a YAML parser - enough
// to catch drift, not enough to be worth a dependency.

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

let blueprint;
let pkg;
let envExample;

beforeAll(async () => {
  blueprint = await read("render.yaml");
  pkg = JSON.parse(await read("package.json"));
  envExample = await read(".env.example");
});

// Everything documented as required has to be either prompted for or set
// outright, or the first deploy comes up missing one.
const requiredEnvKeys = (source) => {
  const keys = [];
  let required = false;
  for (const line of source.split("\n")) {
    const section = line.match(/^# --- (.+?) -+$/);
    if (section) required = /required/i.test(section[1]);
    const assignment = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (assignment && required) keys.push(assignment[1]);
  }
  return keys;
};

describe("render.yaml", () => {
  it("runs the same commands the repo defines", () => {
    expect(pkg.scripts.start).toBeTruthy();
    expect(blueprint).toContain("startCommand: npm start");
    expect(blueprint).toContain("buildCommand: npm ci");
  });

  it("points the health check at a route that exists", async () => {
    expect(blueprint).toContain("healthCheckPath: /");
    expect(await read("server.js")).toMatch(/app\.get\("\/"/);
  });

  it("names the free plan, so a deploy cannot quietly start billing", () => {
    expect(blueprint).toContain("plan: free");
  });

  it("covers every variable .env.example calls required", () => {
    const required = requiredEnvKeys(envExample);
    // Guards the parser above: an empty list would pass vacuously.
    expect(required).toContain("MONGO_URI");
    expect(required.length).toBeGreaterThan(3);

    for (const key of required) {
      expect(blueprint, `render.yaml is missing ${key}`).toContain(`- key: ${key}`);
    }
  });

  it("generates the signing secret rather than asking for one", () => {
    expect(blueprint).toMatch(/- key: JWT_SECRET\n\s+generateValue: true/);
  });

  it("asks for the secrets instead of storing them", () => {
    for (const key of ["MONGO_URI", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]) {
      expect(blueprint).toMatch(new RegExp(`- key: ${key}\\n\\s+sync: false`));
    }
    // No secret has a literal value in a committed file.
    expect(blueprint).not.toMatch(/mongodb\+srv:\/\//);
  });

  it("runs in production mode", () => {
    expect(blueprint).toMatch(/- key: NODE_ENV\n\s+value: production/);
  });
});

// Everything the code reads has to be described somewhere a deployer will
// look. ADMIN_USERNAMES was added to render.yaml and to the startup
// warnings and never to .env.example - which the README calls "the full
// list", and which the deployment steps say to work through - so the one
// variable standing between a moderation queue and nobody able to read it
// was invisible to anyone following the instructions.
describe(".env.example", () => {
  it("describes every environment variable the code actually reads", async () => {
    const { readdir } = await import("node:fs/promises");
    const root = new URL("../", import.meta.url);
    const skip = new Set(["node_modules", ".git", "tests", "coverage", "docs"]);

    const sources = [];
    const walk = async (dir) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
        if (entry.isDirectory()) await walk(child);
        else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) sources.push(child);
      }
    };
    await walk(root);

    const used = new Set();
    for (const file of sources) {
      const source = await readFile(file, "utf8");
      // Catches process.env.FOO and the env.FOO of a function that takes
      // the environment as an argument, which is how the admin list is
      // read - and is exactly why a plain search for "process.env" missed
      // it.
      for (const [, key] of source.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)) used.add(key);
    }

    // Guards the walk above: an empty set would pass vacuously.
    expect(used.has("MONGO_URI")).toBe(true);
    expect(used.size).toBeGreaterThan(8);

    for (const key of [...used].sort()) {
      expect(envExample, `.env.example does not mention ${key}`).toMatch(
        new RegExp(`^${key}=`, "m")
      );
    }
  });
});
