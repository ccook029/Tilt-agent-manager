import { defineConfig } from "vitest/config";
import path from "path";

// .mts rather than .ts so Vite loads it as real ESM. As plain .ts it works but
// warns on every run that it's ESM syntax in a file loaded as CommonJS, and a
// warning nobody can act on is a warning everybody learns to scroll past.
//
// Otherwise this mirrors tiltweb's config — same `@` alias, same include glob —
// so a test reads the same in either repo. The alias is the part that matters:
// everything under src/ imports via "@/lib/…", and without it a test fails at
// module resolution rather than on an assertion.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
