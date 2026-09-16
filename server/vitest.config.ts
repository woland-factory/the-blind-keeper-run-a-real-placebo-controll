import { defineConfig } from "vitest/config";

// Every DB-backed test file builds its own in-process PGlite database in its
// beforeAll. On a loaded shared host, letting every core run a heavy database
// file at once can exhaust memory and fail a beforeAll before the suite even
// asserts. Cap concurrency so the whole suite stays reliably green; the tests
// themselves are independent and order-agnostic.
export default defineConfig({
  test: {
    pool: "forks",
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
  },
});
