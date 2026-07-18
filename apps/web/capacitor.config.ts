import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor shell config. The web app is the source of truth — `npm run build`
 * produces dist/, `npx cap sync` copies it into the native projects.
 *
 * Live-reload against the dev server while developing natively:
 *   server: { url: "http://192.168.1.x:5173", cleartext: true }
 */
const config: CapacitorConfig = {
  appId: "com.aloft.game",
  appName: "Aloft",
  webDir: "dist",
  backgroundColor: "#0b1020",
  ios: {
    contentInset: "never",
    backgroundColor: "#0b1020",
  },
  android: {
    backgroundColor: "#0b1020",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: "#0b1020",
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    Geolocation: {
      // Background location is what the native shell buys us over the PWA:
      // real "a plane just entered your radius" alerts while the app is closed.
    },
  },
};

export default config;
