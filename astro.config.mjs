import { defineConfig } from "astro/config";
import node from "@astrojs/node";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  server: { port: 4321, host: "127.0.0.1" },
  vite: {
    ssr: {
      // better-sqlite3 is a native module — exclude from SSR bundle
      external: ["better-sqlite3"],
    },
  },
});
