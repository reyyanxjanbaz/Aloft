import type { FlightProvider } from "./types";
import { fetchReadsbPoint } from "./types";

export class AirplanesLiveProvider implements FlightProvider {
  readonly name = "airplanes.live";

  getAircraftNear(lat: number, lon: number, radiusNm: number) {
    return fetchReadsbPoint("https://api.airplanes.live", lat, lon, radiusNm);
  }
}
