import { familyOf, typeName } from "@aloft/shared";
import type { HangarEntry } from "../hangar/db";
import { GLYPH_SHAPES } from "../hangar/AircraftGlyph";
import { DECK_HEX, RARITY_HEX, RARITY_LABEL } from "../../ui/rarity";

/**
 * A catch as a shareable card, drawn on-device.
 *
 * Catching a legendary and having nothing to show for it outside the app is
 * a hole in the loop. Rendering locally means no server, no upload, and
 * nothing leaves the device unless the player picks a destination.
 *
 * Composed entirely from flat fills and hairlines — the same rules as the
 * rest of the interface, since a card that looked nothing like the app would
 * be worse than none.
 */

const W = 1080;
const H = 1350;
const MARGIN = 64;

export interface CatchCardInput {
  entry: HangarEntry;
  firstSpotter: boolean;
  spotterCode?: string;
  /** A snapshot of the live 3D model, when the stage could provide one. */
  snapshotDataUrl?: string | null;
}

/** The text the card will draw. Pure, so the layout can be tested. */
export interface CardLayout {
  eyebrow: string;
  type: string;
  ident: string;
  rarityLabel: string;
  rarityHex: string;
  readouts: string[];
  firstSpotter: boolean;
  footer: string;
}

export function composeCardLayout(input: CatchCardInput): CardLayout {
  const { entry } = input;
  const caught = new Date(entry.caughtAt);
  const date = caught.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });

  const readouts = [
    entry.altFt > 0 ? `${Math.round(entry.altFt).toLocaleString()} ft` : "On the ground",
    `${entry.distanceKm.toFixed(1)} km`,
    date,
  ];

  return {
    eyebrow: "Aloft · Captured",
    type: entry.typeLabel || typeName(entry.typeIcao),
    ident: entry.callsign || entry.reg || entry.hex.toUpperCase(),
    rarityLabel: RARITY_LABEL[entry.rarity],
    rarityHex: RARITY_HEX[entry.rarity],
    readouts,
    firstSpotter: input.firstSpotter,
    footer: input.spotterCode ? `Spotter ${input.spotterCode}` : "aloft-one.vercel.app",
  };
}

/** Loads the bundled faces so the first render isn't drawn in a fallback. */
async function ensureFonts(): Promise<void> {
  if (!("fonts" in document)) return;
  await Promise.all([
    document.fonts.load('700 64px "Chakra Petch"'),
    document.fonts.load('600 34px "Chakra Petch"'),
    document.fonts.load('500 30px "JetBrains Mono Variable"'),
  ]).catch(() => {});
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Corner ticks — an instrument frame, not a border. */
function drawFrame(ctx: CanvasRenderingContext2D, color: string): void {
  const inset = 40;
  const tick = 56;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);

  ctx.lineWidth = 6;
  const corners: Array<[number, number, number, number]> = [
    [inset, inset, 1, 1],
    [W - inset, inset, -1, 1],
    [inset, H - inset, 1, -1],
    [W - inset, H - inset, -1, -1],
  ];
  for (const [x, y, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x + tick * dx, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + tick * dy);
    ctx.stroke();
  }
}

/** Six-pointed instrument star for the first-spotter mark. */
function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const angle = (Math.PI / 6) * i - Math.PI / 2;
    const radius = i % 2 === 0 ? r : r * 0.42;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

export async function renderCatchCard(input: CatchCardInput): Promise<Blob> {
  const layout = composeCardLayout(input);
  await ensureFonts();

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable on this device");

  ctx.fillStyle = DECK_HEX.void;
  ctx.fillRect(0, 0, W, H);
  drawFrame(ctx, layout.rarityHex);

  // ── Eyebrow ─────────────────────────────────────────────
  ctx.fillStyle = DECK_HEX.ink3;
  ctx.font = '500 26px "JetBrains Mono Variable", monospace';
  ctx.letterSpacing = "6px";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(layout.eyebrow.toUpperCase(), MARGIN + 24, MARGIN + 84);
  ctx.letterSpacing = "0px";

  // ── Subject: the model snapshot, or the family silhouette ──
  const artTop = 220;
  const artHeight = 520;
  const snapshot = input.snapshotDataUrl ? await loadImage(input.snapshotDataUrl) : null;

  if (snapshot) {
    // Contain-fit so a wide render never crops the wingtips off.
    const scale = Math.min((W - MARGIN * 2 - 48) / snapshot.width, artHeight / snapshot.height);
    const w = snapshot.width * scale;
    const h = snapshot.height * scale;
    ctx.drawImage(snapshot, (W - w) / 2, artTop + (artHeight - h) / 2, w, h);
  } else {
    // The glyph is authored on a 64x60 grid.
    const glyphScale = artHeight / 60;
    ctx.save();
    ctx.translate((W - 64 * glyphScale) / 2, artTop);
    ctx.scale(glyphScale, glyphScale);
    const path = new Path2D(GLYPH_SHAPES[familyOf(input.entry.typeIcao)]);
    ctx.fillStyle = DECK_HEX.deck;
    ctx.fill(path);
    ctx.strokeStyle = DECK_HEX.phos;
    ctx.lineWidth = 0.9;
    ctx.stroke(path);
    ctx.restore();
  }

  // ── Rarity band ─────────────────────────────────────────
  let y = 838;
  ctx.fillStyle = layout.rarityHex;
  ctx.fillRect(MARGIN + 24, y, 96, 4);
  y += 46;
  ctx.font = '600 30px "Chakra Petch", sans-serif';
  ctx.letterSpacing = "8px";
  ctx.fillText(layout.rarityLabel.toUpperCase(), MARGIN + 24, y);
  ctx.letterSpacing = "0px";

  // ── Ident ───────────────────────────────────────────────
  y += 82;
  ctx.fillStyle = DECK_HEX.ink;
  ctx.font = '700 68px "Chakra Petch", sans-serif';
  ctx.fillText(layout.type, MARGIN + 24, y);

  y += 54;
  ctx.fillStyle = DECK_HEX.ink2;
  ctx.font = '500 34px "JetBrains Mono Variable", monospace';
  ctx.fillText(layout.ident, MARGIN + 24, y);

  // ── First spotter ───────────────────────────────────────
  if (layout.firstSpotter) {
    y += 74;
    drawStar(ctx, MARGIN + 38, y - 10, 18, DECK_HEX.amber);
    ctx.fillStyle = DECK_HEX.amber;
    ctx.font = '600 28px "Chakra Petch", sans-serif';
    ctx.letterSpacing = "5px";
    ctx.fillText("FIRST SPOTTER", MARGIN + 70, y);
    ctx.letterSpacing = "0px";
  }

  // ── Readouts ────────────────────────────────────────────
  const readoutY = H - 190;
  ctx.strokeStyle = DECK_HEX.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(MARGIN + 24, readoutY - 44);
  ctx.lineTo(W - MARGIN - 24, readoutY - 44);
  ctx.stroke();

  ctx.font = '500 30px "JetBrains Mono Variable", monospace';
  const columnWidth = (W - (MARGIN + 24) * 2) / layout.readouts.length;
  layout.readouts.forEach((value, i) => {
    ctx.fillStyle = DECK_HEX.ink;
    ctx.fillText(value, MARGIN + 24 + columnWidth * i, readoutY);
  });

  // ── Footer ──────────────────────────────────────────────
  ctx.strokeStyle = DECK_HEX.rule;
  ctx.beginPath();
  ctx.moveTo(MARGIN + 24, H - 130);
  ctx.lineTo(W - MARGIN - 24, H - 130);
  ctx.stroke();

  ctx.fillStyle = DECK_HEX.ink3;
  ctx.font = '500 26px "JetBrains Mono Variable", monospace';
  ctx.letterSpacing = "4px";
  ctx.fillText(layout.footer.toUpperCase(), MARGIN + 24, H - 82);
  ctx.letterSpacing = "0px";

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not render the card"))),
      "image/png"
    );
  });
}
