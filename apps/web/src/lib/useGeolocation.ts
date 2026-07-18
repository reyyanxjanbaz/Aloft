import { useEffect, useState } from "react";

export interface PlayerPosition {
  lat: number;
  lon: number;
  /** True when the position came from ?lat=..&lon=.. instead of the GPS. */
  simulated: boolean;
}

/**
 * Player position with a dev/simulator override: append ?lat=51.47&lon=-0.45
 * to the URL to stand anywhere in the world without leaving your desk.
 */
export function useGeolocation(): { position: PlayerPosition | null; error: string | null } {
  const [position, setPosition] = useState<PlayerPosition | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const lat = Number(params.get("lat"));
    const lon = Number(params.get("lon"));
    if (Number.isFinite(lat) && Number.isFinite(lon) && params.has("lat")) {
      setPosition({ lat, lon, simulated: true });
      return;
    }

    if (!("geolocation" in navigator)) {
      setError("Geolocation is not available in this browser.");
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition({ lat: pos.coords.latitude, lon: pos.coords.longitude, simulated: false });
        setError(null);
      },
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  return { position, error };
}
