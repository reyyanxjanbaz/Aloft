import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
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
        manualChunks: {
          maplibre: ["maplibre-gl"],
          three: ["three", "@react-three/fiber", "@react-three/drei"]
        }
      }
    }
  },
  server: {
    port: 5173
  }
});
