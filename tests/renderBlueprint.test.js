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
