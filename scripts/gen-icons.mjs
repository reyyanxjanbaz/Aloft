// Generates placeholder PWA icons (paper-plane glyph on the Aloft night-sky
// background) with zero dependencies: raw RGBA → zlib → hand-built PNG chunks.
// Replace with real artwork later; run via `npm run gen:icons`.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "public");
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixels) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Paper-plane silhouette on the unit square (even-odd fill).
const PLANE = [
  [0.5, 0.16],
  [0.86, 0.82],
  [0.5, 0.66],
  [0.14, 0.82],
];

function insidePlane(x, y) {
  let inside = false;
  for (let i = 0, j = PLANE.length - 1; i < PLANE.length; j = i++) {
    const [xi, yi] = PLANE[i];
    const [xj, yj] = PLANE[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function renderIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Vertical night-sky gradient #0b1020 → #16224a.
      const t = y / size;
      let [r, g, b] = [11 + t * 11, 16 + t * 18, 32 + t * 42];
      // 4×4 supersampled plane glyph for soft edges.
      let hits = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++)
          if (insidePlane((x + (sx + 0.5) / 4) / size, (y + (sy + 0.5) / 4) / size)) hits++;
      if (hits > 0) {
        const a = hits / 16;
        r = r * (1 - a) + 125 * a; // #7dd3fc sky blue
        g = g * (1 - a) + 211 * a;
        b = b * (1 - a) + 252 * a;
      }
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  }
  return encodePng(size, px);
}

for (const [name, size] of [
  ["pwa-192.png", 192],
  ["pwa-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  writeFileSync(join(outDir, name), renderIcon(size));
  console.log(`wrote ${name} (${size}×${size})`);
}
