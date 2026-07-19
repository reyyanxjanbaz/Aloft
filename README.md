# ✈ Aloft

Pokémon GO for avgeeks: a PWA where you catch real planes from the real sky and build a hangar of 3D aircraft.

Full product & technical plan: see the plan doc (`~/.claude/plans/the-goal-is-to-elegant-book.md`).

## Structure

- `apps/web` — the PWA: React + Vite + MapLibre dark radar, installable on Android & iOS. Hosted on Vercel.
- `apps/sky` — `aloft-sky`: Fastify + WebSocket service that polls free ADS-B providers (adsb.lol primary, airplanes.live failover), dedupes requests per geographic cell, and streams nearby aircraft to each player. Hosted on Railway.
- `packages/shared` — shared types + geo math (bearing, elevation, dead reckoning) used by both.
- `supabase/schema.sql` — durable state: players, catches, friendships, push subscriptions. Apply with `npm run db:schema`.

Live plane state and position-fix history live in memory in `SkyHub`, so the service runs as a **single instance** — never scale it past one replica.

## Run it

```bash
npm install
npm run gen:icons   # once: generates placeholder PWA icons
vercel env pull     # once: writes .env.local (Postgres + VAPID keys)
npm run db:schema   # once: applies supabase/schema.sql
npm run dev         # starts sky (:8787) and web (:5173) together
```

The sky service reads `.env.local` automatically, so no exports are needed.

Open http://localhost:5173 — allow location, and live aircraft within 15 km appear on the radar. No planes near you right now? Stand at Heathrow instead:

```
http://localhost:5173/?lat=51.47&lon=-0.45
```

Tap a plane for its card: callsign, type, registration, altitude, speed, distance, elevation angle ("look up 46°"), and its route via adsbdb.com.

## Tests & checks

```bash
npm test                                  # geo math unit tests (vitest)
npm test --workspace apps/sky             # Postgres-backed store tests
npm run typecheck --workspace apps/sky    # sky typecheck
npm run build                             # web typecheck + production build
```

The sky suite needs a database; without one those suites skip rather than fail.

## Environment

`apps/sky` (set on Railway): `DATABASE_URL` — the Supabase **Supavisor pooler** URI on port 6543. The direct endpoint is IPv6-only and will not connect, and the pooler runs in transaction mode, which is why `postgres.js` is constructed with `prepare: false`. Also `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. `PORT` is injected by Railway.

`apps/web` (set on Vercel): `VITE_SKY_URL` — the public Railway URL.

Locally, `.env.local` (from `vercel env pull`) supplies all of these; `POSTGRES_URL` is accepted in place of `DATABASE_URL`.

Debug endpoints on the sky service:

```bash
curl 'http://localhost:8787/planes?lat=51.47&lon=-0.45&radiusKm=15'
curl 'http://localhost:8787/health'
```

## Data licensing

Live positions come from community ADS-B feeds (adsb.lol / airplanes.live) which are **non-commercial**. The provider layer (`apps/sky/src/providers`) is an interface — swap in a commercial feed (FR24 / FlightAware) before monetizing.

## Playing (M1)

Tap a plane → **Hunt this plane** → arm the radar (grants camera + motion permissions). Sweep the phone across the sky following the guide arrow; when the mystery silhouette locks on, hold steady for 2.5 s to fill the capture ring. Catches are validated server-side against the plane's actual position history — GPS spoofing gets a 422. Successful catches reveal a rotatable 3D model with a rarity banner and land in your offline **Hangar** (IndexedDB).

On desktop or in simulator mode there's no compass, so the hunt falls back to **drag-to-aim** — the whole loop is playable at your desk with `?lat=51.47&lon=-0.45`.

## Progression & pings (M2)

- **Achievements** (12 to start — counts, rarity firsts, altitude, night ops, overhead, streaks) unlock with animated chips on the reveal screen and live on a badge wall in the Hangar, alongside your 🔥 day-streak.
- **Sky pings**: after your first catch, the reveal screen offers "Ping me when something good flies over." The sky service then geofences your spot every minute and sends a Web Push when an uncommon-or-better aircraft enters your radius — rarity-teased ("Something rare is inbound from the west…"), max one ping per 30 min, never the same airframe twice. VAPID keys are auto-generated into `apps/sky/data/` on first run. In a deployed environment the service **refuses to start** without `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` — the container filesystem is ephemeral, so generated keys would be replaced on every deploy and silently invalidate every existing subscription.
- **Install walkthrough**: after the first catch, iOS players get the Add-to-Home-Screen guide (required for push on iOS 16.4+); Android/desktop get the native install prompt.
- Note: push requires the built app (`npm run build && npm run preview --workspace apps/web`) — the dev server doesn't register the service worker.

## Spotters & social (M3)

Tap **👥** on the radar. You get a 6-character spotter code (ambiguous characters like `0`/`O` left out — codes get read aloud): share it via the native share sheet or an invite link (`/?invite=CODE`, auto-accepted on open). Friending is mutual and instant.

- **Friends** — each with their catch count, rarity score, streak, and best find; tap to browse their hangar. Hangars are private until you're friends (403 otherwise).
- **This week** — a rolling 7-day leaderboard by rarity score among you and your friends.
- **Activity** — friends' rare-and-above catches and first spots.
- **First Spotter** — the first player ever to catch a given airframe gets a gold banner on the reveal and a 🥇 on that catch forever. It never transfers.

Identity is device-local for now (`localStorage` + `x-player-id`), so social works with zero signup friction. `supabase/schema.sql` is the drop-in migration to managed Postgres — tables, indexes, the weekly-leaderboard materialized view, and RLS policies (including friends-only hangar reads) are written and ready to apply; wiring it up means replacing `SocialStore`'s internals, not the routes.

## Polish & native (M4)

- **3D model pipeline** — `AircraftModel` loads a real GLB when the library has one for that type and silently falls back to the in-app procedural model otherwise. Adding models is a data change: drop a `.glb` in `apps/web/public/models/` and register it in `manifest.json` (exact ICAO type wins, family entry is the catch-all). Credited models appear automatically on the in-app Credits screen (ⓘ in the HUD), which satisfies CC-BY attribution.
- **Sound & haptics** — every cue is synthesized with WebAudio at runtime, so there are no audio files to license, download, or cache: accelerating lock ticks as the capture ring fills, a whoosh-and-sweep on capture, and a reveal chord that grows from a triad to a major 9th with rarity (legendaries get the full fanfare and a longer haptic pattern). Mute lives in the HUD (🔊) and persists.
- **Capacitor-ready** — `lib/platform.ts` routes haptics, share, background location, and push through native plugins when running in a Capacitor shell and through standard web APIs otherwise, resolved lazily so the PWA build carries zero native dependencies. `capacitor.config.ts` and `cap:*` scripts are in place.

See **[docs/native-and-assets.md](docs/native-and-assets.md)** for the model preparation workflow, the native build steps (permissions, capabilities, APNs/FCM), and the store-listing checklist.

## Roadmap

M0 radar ✅ → M1 sensor-AR capture + 3D reveal ✅ → M2 achievements/streaks/push/install ✅ → M3 social: friends, hangar visits, leaderboards, first-spotter ✅ → M4 model pipeline, sound/haptics, Capacitor scaffold ✅

The game loop is complete and playable end to end. What's left needs accounts or money, not code: buy/commission GLB models and register them in the manifest, create a Supabase project and point `SocialStore` at `supabase/schema.sql`, and run the Capacitor build with Apple/Google developer accounts. Each has a documented path and a working fallback in the meantime.
