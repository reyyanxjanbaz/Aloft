import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Registration is ours (lib/swUpdate.ts) so the update path is explicit
      // and testable rather than split between generated glue and app code.
      injectRegister: null,
      registerType: "autoUpdate",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      includeAssets: ["apple-touch-icon.png"],
      manifest: {
        name: "Aloft — catch the sky",
        short_name: "Aloft",
        description: "Catch real planes from the real sky and build your hangar.",
        start_url: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#040706",
        theme_color: "#040706",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        /*
         * Split by module id, not by entry point.
         *
         * The array form (`three: ["three", "@react-three/fiber", ...]`) pulled
         * React into the three chunk as well, because react-three depends on
         * it — so the entry imported React *from* the 1.2 MB three chunk and
         * every visitor downloaded the whole 3D stack to reach the scope. The
         * viewer being lazy could not help while React lived inside it.
         *
         * Matching on the path keeps three and its react bindings together and
         * leaves React itself where the rest of the app can reach it.
         */
        manualChunks(id: string) {
          // Pinned first, and deliberately. React and zustand are shared
          // between the app and @react-three/fiber, so left to itself Rollup
          // hoists them into whichever vendor chunk it likes — which put React
          // inside the 1.2 MB three chunk and dragged the whole 3D stack onto
          // the critical path no matter how lazily the viewer was imported.
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/scheduler/") ||
            id.includes("node_modules/zustand/") ||
            // Vite's own dynamic-import helper. Left unpinned it lands in
            // whichever chunk happens to claim it first — which was the three
            // chunk, so the entry statically imported 972 KB of 3D engine to
            // reach one twenty-line function.
            id.includes("vite/preload-helper")
          ) {
            return "vendor";
          }
          if (id.includes("node_modules/maplibre-gl/")) return "maplibre";
          if (id.includes("node_modules/three/") || id.includes("node_modules/@react-three/")) {
            return "three";
          }
          return undefined;
        }
      }
    }
  },
  server: {
    port: 5173
  }
});
