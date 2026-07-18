# Native builds & asset pipeline

Everything here is scaffolded in code; these are the steps that need your accounts, money, or a Mac with Xcode.

## 1. Adding real 3D models

The reveal and hangar render through `AircraftModel`, which asks `modelRegistry` for a GLB and silently falls back to the procedural stylized model when there isn't one. **Adding models is a data change, not a code change.**

1. Get a model. Check the license — CC0 or CC-BY (credit required) from Sketchfab, or a royalty-free purchase from CGTrader/TurboSquid. Budget for full launch coverage is roughly $100–300.
2. Prepare it: triangulate, keep it under ~30k triangles, face **+Z** (nose forward), and name the material that should take the airline color `accent` or `livery`. Export as `.glb` with Draco compression:
   ```bash
   npx gltf-transform optimize input.glb apps/web/public/models/a320.glb --compress draco --texture-size 1024
   ```
   Aim for 200–500 KB per model.
3. Register it in `apps/web/public/models/manifest.json`:
   ```json
   {
     "version": 1,
     "baseUrl": "/models/",
     "models": {
       "A320": { "file": "a320.glb", "author": "Jane Doe", "license": "CC-BY 4.0", "sourceUrl": "https://..." },
       "widebody": { "file": "widebody.glb", "scale": 0.8 }
     }
   }
   ```
   Keys are ICAO type designators (`A320`, `B77W`) **or** family names (`narrowbody`, `widebody`, `quad`, `turboprop`, `ga`). Exact type wins; family is the catch-all. Anything credited appears automatically on the in-app Credits screen (ⓘ in the radar HUD) — that's how CC-BY attribution is satisfied.

Priority order for the first 15 models: A320 family, 737 family, A350, 787, 777, A330, 747, A380, E-Jet, CRJ, ATR/Dash-8, 767, 757, bizjet, generic military.

For production, move `baseUrl` to a CDN (Supabase Storage) so models aren't part of the app bundle.

## 2. Capacitor native builds

The PWA is complete on its own; the native shell adds **true background geolocation** (real-time "a plane entered your radius" alerts while the app is closed), native push, and store listings. `apps/web/src/lib/platform.ts` already routes haptics, share, background location, and push registration to native plugins when they exist, so no app code changes.

```bash
cd apps/web
npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android \
      @capacitor/geolocation @capacitor/haptics @capacitor/share \
      @capacitor/push-notifications @capacitor/splash-screen
npm run cap:add     # builds the web app and creates ios/ and android/
npm run cap:ios     # opens Xcode
npm run cap:android # opens Android Studio
```

Then, per platform:

**iOS** (needs a Mac + Xcode, and $99/yr Apple Developer account to ship)
- `Info.plist`: `NSCameraUsageDescription` ("Aloft uses the camera so you can spot and capture aircraft in the sky"), `NSLocationWhenInUseUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription` ("so Aloft can alert you when a rare aircraft flies overhead"), `NSMotionUsageDescription`.
- Capabilities: Push Notifications, Background Modes → Location updates + Remote notifications.
- Push uses APNs, not Web Push — register the token from `registerNativePush()` with the sky service and send via APNs there.

**Android** (needs a $25 one-time Google Play account to ship)
- `AndroidManifest.xml`: `CAMERA`, `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `POST_NOTIFICATIONS`, `VIBRATE`.
- Background location requires a separate runtime prompt and a Play Store justification — explain the plane-alert use case in the listing.
- Push uses FCM: add `google-services.json`.

Keep shipping the PWA in parallel — it stays the zero-friction way to try the game.

## 3. Store listing checklist

- Icons/splash: replace the generated placeholders (`npm run gen:icons`) with real artwork; run `npx @capacitor/assets generate` to produce every native size.
- Screenshots: radar view, mid-hunt with the capture ring, a legendary reveal, the hangar.
- Privacy policy (required by both stores): state that location is used to find nearby aircraft and never sold, and that catches are stored on-device plus on your server for the social features.
- **Data licensing gate**: adsb.lol and airplanes.live are non-commercial. Before any paid app, in-app purchase, or ads, swap `FlightProvider` for a commercial feed (Flightradar24 / FlightAware AeroAPI). The interface already exists — it's a one-class change in `apps/sky/src/providers/`.
