import { defineConfig } from 'astro/config';
import tailwindcss from "@tailwindcss/vite";
import react from "@astrojs/react";
import node from "@astrojs/node";
import sitemap from "@astrojs/sitemap";

// https://astro.build/config
export default defineConfig({
  site: "https://journees-innovation-bois.xylofutur.fr",
  // L'espace participant reste hors du sitemap : pages privées, noindex.
  integrations: [react(), sitemap({ filter: (page) => !new URL(page).pathname.startsWith("/espace/") })],
  output: "server",
  adapter: node({ mode: "standalone" }),
  vite: {
    plugins: [tailwindcss()],
  },
});
