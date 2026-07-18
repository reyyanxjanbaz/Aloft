import type { AchievementIcon as Key } from "@aloft/shared";
import {
  IconAircraft,
  IconAltitude,
  IconDeparture,
  IconInFlight,
  IconMedal,
  IconNight,
  IconPin,
  IconStar,
  IconStreak,
  IconTimer,
  IconTrophy,
  IconWorld,
} from "./icons";

const MAP = {
  departure: IconDeparture,
  aircraft: IconAircraft,
  world: IconWorld,
  inflight: IconInFlight,
  star: IconStar,
  medal: IconMedal,
  trophy: IconTrophy,
  altitude: IconAltitude,
  night: IconNight,
  pin: IconPin,
  streak: IconStreak,
  timer: IconTimer,
} as const satisfies Record<Key, unknown>;

/** Maps a shared achievement's semantic icon key onto the app's icon set. */
export function AchievementIcon({
  name,
  size = 20,
  weight = "regular",
}: {
  name: Key;
  size?: number;
  weight?: "regular" | "bold" | "fill";
}) {
  const Component = MAP[name];
  return <Component size={size} weight={weight} />;
}
