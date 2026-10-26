// XOVIA Battle Generations — standalone Vite configuration.
// Fully detached from the Lovable toolchain: every plugin is declared explicitly here.
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "node:path";

// TanStack Start uses virtual entry ids (`#tanstack-router-entry`,
// `tanstack-start-manifest:v`, ...) that are resolved at runtime by its Vite
// plugin. Vite's esbuild dep scanner can't resolve them, so mark them external.
const tanstackExternalPlugin = {
  name: "tanstack-virtual-external",
  setup(build) {
    build.onResolve({ filter: /tanstack-start-manifest:v|tanstack-start-injected-head-scripts:v/ }, () => ({
      external: true,
    }));
    build.onResolve({ filter: /^#tanstack-/ }, () => ({ external: true }));
  },
};

export default defineConfig({
  plugins: [
    // TanStack Start must come first — it registers the router plugin itself,
    // which must precede the JSX transform plugin.
    tanstackStart({
      server: { entry: "server" },
    }),
    tsConfigPaths(),
    viteReact(),
    tailwindcss(),
    // Cloudflare Workers build target.
    cloudflare(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-start"],
  },
  define: {
    // Surface only public, VITE_-prefixed values to the client bundle.
    // Server secrets (service role keys, OAuth client secrets) stay server-side only.
  },
  optimizeDeps: {
    // TanStack Start packages resolve virtual `#tanstack-*-entry` imports via
    // the plugin's aliases, which esbuild's dep scanner can't handle. Exclude
    // them so Vite processes them through the plugin pipeline instead.
    esbuildOptions: { plugins: [tanstackExternalPlugin] },
    exclude: [
      "@tanstack/react-start",
      "@tanstack/react-start-client",
      "@tanstack/react-start-server",
      "@tanstack/react-start-rsc",
      "@tanstack/react-router",
      "@tanstack/router-core",
      "@tanstack/router-plugin",
      "@tanstack/start-client-core",
      "@tanstack/start-server-core",
      "@tanstack/start-plugin-core",
      "@tanstack/start-storage-context",
      "@tanstack/history",
    ],
  },
  build: {
    target: "esnext",
    sourcemap: false,
  },
});
