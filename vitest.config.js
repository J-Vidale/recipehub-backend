import { defineConfig } from "vitest/config";

// The API's pure units and its middleware, exercised without a database.
// Anything needing a live MongoDB belongs in a separate integration run;
// these have to stay fast enough that CI runs them on every push.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    restoreMocks: true,
  },
});
