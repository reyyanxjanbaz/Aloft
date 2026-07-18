/**
 * Airline brand accent colors keyed by ICAO callsign prefix — the MVP
 * "procedural livery": tail, wingtips, and engines take the airline color.
 * Unknown operators get a stable hue hashed from their prefix.
 */
const LIVERIES: Record<string, string> = {
  BAW: "#075aaa", // British Airways
  VIR: "#e10a17", // Virgin Atlantic
  UAL: "#005daa", // United
  AAL: "#b61f23", // American
  DAL: "#c8102e", // Delta
  SWA: "#f9b612", // Southwest
  JBU: "#003876", // JetBlue
  ASA: "#01426a", // Alaska
  ACA: "#d22630", // Air Canada
  WJA: "#00aed9", // WestJet
  RYR: "#073590", // Ryanair
  EZY: "#ff6600", // easyJet
  DLH: "#05164d", // Lufthansa
  AFR: "#002157", // Air France
  KLM: "#00a1de", // KLM
  IBE: "#d7192d", // Iberia
  TAP: "#00785a", // TAP
  EIN: "#00a65e", // Aer Lingus
  THY: "#c90c0f", // Turkish
  UAE: "#d71920", // Emirates
  QTR: "#5c0d34", // Qatar
  ETD: "#bd8b13", // Etihad
  SIA: "#0f2d52", // Singapore
  CPA: "#00645a", // Cathay
  ANA: "#00467f", // ANA
  JAL: "#b60005", // JAL
  QFA: "#e40000", // Qantas
  FDX: "#4d148c", // FedEx
  UPS: "#644117", // UPS
  GTI: "#00263a", // Atlas Air
};

export function accentColor(callsign: string): string {
  const prefix = (callsign || "ZZZ").slice(0, 3).toUpperCase();
  const branded = LIVERIES[prefix];
  if (branded) return branded;
  let h = 0;
  for (const c of prefix) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h}, 70%, 52%)`;
}
