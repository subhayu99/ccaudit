import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  splitting: false,
  shims: true,
  banner: { js: "#!/usr/bin/env node" },
  dts: false, // CLI binary — no type declarations needed
});
