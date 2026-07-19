import type { FlightProvider } from "./types";
import { fetchReadsbHex, fetchReadsbPoint } from "./types";

export class AirplanesLiveProvider implements FlightProvider {
  readonly name = "airplanes.live";

  getAircraftNear(lat: number, lon: number, radiusNm: number) {
    return fetchReadsbPoint("https://api.airplanes.live", lat, lon, radiusNm);
  }

  getAirframe(hex: string) {
    return fetchReadsbHex("https://api.airplanes.live", hex);
  }
}
