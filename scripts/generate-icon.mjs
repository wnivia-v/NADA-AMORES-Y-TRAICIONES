// =============================================================================
// Icon generator — rasterizes NADA's shield mark to PNG with zero dependencies.
//
// Why this exists: public/favicon.svg is the only icon asset, and Windows
// rejects SVG for both BrowserWindow and Tray. nativeImage.createFromPath on an
// SVG returns an empty image, so `new Tray(empty)` fails and the app has no
// tray icon. electron-builder also needs a raster >=256px to derive the .ico.
//
// Rather than pull in a native rasterizer (sharp/resvg), this draws the same
// geometry as favicon.svg analytically: signed distance to the shield outline
// and to the checkmark polyline, with 1px antialiasing, then encodes a PNG by
// hand (IHDR/IDAT/IEND + CRC32 + zlib deflate, all from node:zlib).
//
// Usage: node scripts/generate-icon.mjs
// =============================================================================

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Brand ────────────────────────────────────────────────────────────────────
const BG = [0x0a, 0x0e, 0x17]; // #0A0E17
const FG = [0x00, 0xff, 0x88]; // #00FF88

// Geometry in the SVG's 0..100 viewBox space
const CORNER_RADIUS = 20;
const STROKE = 5; // slightly heavier than the SVG's 4 so it survives 16x16
const OUTPUTS = [
  { path: 'build/icon.png', size: 512 }, // electron-builder derives .ico here
  { path: 'public/icon.png', size: 512 }, // shipped to dist/ for runtime use
];

// ── Path sampling ────────────────────────────────────────────────────────────
function cubic(p0, c1, c2, p1, steps = 32) {
  const pts = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push([
      u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
      u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
    ]);
  }
  return pts;
}

// M50 20 L70 40 L70 65 C70 78 60 85 50 90 C40 85 30 78 30 65 L30 40 Z
const shield = [
  [50, 20],
  [70, 40],
  [70, 65],
  ...cubic([70, 65], [70, 78], [60, 85], [50, 90]),
  ...cubic([50, 90], [40, 85], [30, 78], [30, 65]),
  [30, 40],
  [50, 20], // close
];

// M42 55 L48 61 L60 47
const check = [
  [42, 55],
  [48, 61],
  [60, 47],
];

// ── Distance helpers ─────────────────────────────────────────────────────────
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function distToPolyline(px, py, pts) {
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < min) min = d;
  }
  return min;
}

/** Signed distance to a rounded rect spanning 0..100 on both axes. */
function roundedRectSdf(px, py, radius) {
  const half = 50;
  const qx = Math.abs(px - half) - (half - radius);
  const qy = Math.abs(py - half) - (half - radius);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - radius;
}

// ── PNG encoding ─────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Prefix every scanline with filter type 0 (None)
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Render ───────────────────────────────────────────────────────────────────
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const scale = size / 100; // 100-space units -> device px
  const aa = 1 / scale; // one device pixel, expressed in 100-space
  const halfStroke = STROKE / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Sample at pixel centre
      const px = (x + 0.5) / scale;
      const py = (y + 0.5) / scale;

      // Background plate
      const bgCoverage = clamp01(0.5 - roundedRectSdf(px, py, CORNER_RADIUS) / aa);

      // Foreground mark: shield outline + checkmark, whichever is closer
      const d = Math.min(distToPolyline(px, py, shield), distToPolyline(px, py, check));
      const fgCoverage = clamp01(0.5 + (halfStroke - d) / aa);

      // Composite mark over plate, both premultiplied by the plate's alpha so
      // the mark never bleeds outside the rounded corners.
      const alpha = bgCoverage;
      const mix = fgCoverage * bgCoverage;
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(BG[0] * (1 - mix) + FG[0] * mix);
      rgba[i + 1] = Math.round(BG[1] * (1 - mix) + FG[1] * mix);
      rgba[i + 2] = Math.round(BG[2] * (1 - mix) + FG[2] * mix);
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }

  return encodePng(size, size, rgba);
}

for (const { path, size } of OUTPUTS) {
  const abs = resolve(ROOT, path);
  mkdirSync(dirname(abs), { recursive: true });
  const png = render(size);
  writeFileSync(abs, png);
  console.log(`${path}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
