import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  server: { port: 4321, host: "127.0.0.1" },
  vite: {
    plugins: [tailwindcss()],
    ssr: {
      // better-sqlite3 is a native module — exclude from SSR bundle
      external: ["better-sqlite3"],
    },
    optimizeDeps: {
      // Pre-bundle the d3 modules used by the graph page's client script so Vite's
      // dev-mode dependency scanner never has to discover them by parsing .astro
      // frontmatter (which it mis-parses → "Failed to scan for dependencies").
      include: ["d3-force", "d3-selection", "d3-zoom", "d3-drag"],
    },
  },
});
