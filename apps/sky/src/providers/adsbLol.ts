import type { FlightProvider } from "./types";
import { fetchReadsbHex, fetchReadsbPoint } from "./types";

export class AdsbLolProvider implements FlightProvider {
  readonly name = "adsb.lol";

  getAircraftNear(lat: number, lon: number, radiusNm: number) {
    return fetchReadsbPoint("https://api.adsb.lol", lat, lon, radiusNm);
  }
  getAirframe(hex: string) {
    return fetchReadsbHex("https://api.adsb.lol", hex);
  }
}
