import { defineConfig } from "astro/config";
import react from "@astrojs/react";

const BASE_URL = process.env.BASE_URL ?? "/";

export default defineConfig({
  base: BASE_URL,
  integrations: [react()]
});
