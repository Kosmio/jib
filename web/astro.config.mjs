import { defineConfig } from 'astro/config';
import tailwind from "@astrojs/tailwind";
import compress from "astro-compress";
import react from "@astrojs/react";

import node from "@astrojs/node";

// https://astro.build/config
export default defineConfig({
  integrations: [tailwind(), compress({
    svg: false
  }), react()],
  output: "server",
  adapter: node({
    mode: "standalone"
  }),
  server: {
    port: 4321
  }
});
