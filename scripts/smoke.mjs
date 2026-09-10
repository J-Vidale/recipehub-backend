// Imports every router and every middleware, so a module that cannot load
// fails the build rather than the first request that needs it.
//
// The list is read from the directories rather than written out, because
// the hand-written one it replaced had drifted: it named five of the
// thirteen routers, and a router added later - or an import broken inside
// one of the eight it did not name - would have gone straight past it.
import { readdir } from "node:fs/promises";

process.env.NODE_ENV = process.env.NODE_ENV || "test";
// The modules read this at import time. A placeholder is enough to load
// them; nothing here signs or verifies anything.
process.env.JWT_SECRET = process.env.JWT_SECRET || "smoke-check-placeholder-secret";

// Relative to this file, which sits one level down from the repo root.
const DIRECTORIES = ["../middleware", "../routes", "../controllers", "../utils", "../models"];

let count = 0;
const failures = [];

for (const dir of DIRECTORIES) {
  const entries = (await readdir(new URL(`${dir}/`, import.meta.url))).filter((n) => n.endsWith(".js"));
  if (entries.length === 0) {
    failures.push(`${dir} matched no modules - the check would pass by finding nothing`);
    continue;
  }
  for (const name of entries.sort()) {
    try {
      await import(`${dir}/${name}`);
      count += 1;
    } catch (error) {
      failures.push(`${dir}/${name}: ${error.message}`);
    }
  }
}

if (failures.length) {
  console.error(`${failures.length} module(s) failed to import:`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(`all ${count} modules import cleanly`);
