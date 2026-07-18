import type { FlightProvider } from "./types";
import { fetchReadsbPoint } from "./types";

export class AdsbLolProvider implements FlightProvider {
  readonly name = "adsb.lol";

  getAircraftNear(lat: number, lon: number, radiusNm: number) {
    return fetchReadsbPoint("https://api.adsb.lol", lat, lon, radiusNm);
  }
}
