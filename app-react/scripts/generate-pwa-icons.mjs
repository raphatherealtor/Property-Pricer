#!/usr/bin/env node
/**
 * Generates the installable-app icon set into `public/icons/`.
 *
 * Deliberately dependency-free: a ~60-line PNG encoder (zlib + CRC32) drawing a
 * brand-consistent glyph with 3×3 supersampling. The alternative — pulling in an
 * image library or shipping binaries with no reproducible source — would mean the
 * app's icons could not be regenerated or reviewed, and the repo's only image
 * dependency is `sharp` via `next`'s optional chain, which this app does not use.
 *
 *   node scripts/generate-pwa-icons.mjs
 *
 * Art direction matches `src/components/app.tsx`'s header mark and the palette in
 * `src/styles.css`: the deck's night navy (`#0B1220` → `#131C30`) with the teal
 * accent (`#0D9488`) and its lighter tint (`#2DD4BF`) as an ascending price-trend
 * glyph — the product's whole premise in one glance.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import {
  APPLE_TOUCH_ICON,
  PLATFORM_APPLE_ICON,
  PWA_ICONS,
  renderManifestJson,
} from "./pwa-manifest.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = join(ROOT, "public");

/* ------------------------------------------------------------------ *
 * Minimal PNG encoder (8-bit RGBA, no interlace, filter type 0)
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** Encode an RGBA pixel buffer as a PNG. */
function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour + alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // One filter byte (0 = None) per scanline.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ *
 * Artwork
 * ------------------------------------------------------------------ */

const hex = (value) => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
];

const BG_TOP = hex("#0B1220");
const BG_BOTTOM = hex("#131C30");
const BASELINE = hex("#2A3A56");
const BAR_MUTED = hex("#0F766E");
const BAR_MID = hex("#0D9488");
const BAR_HIGH = hex("#2DD4BF");

/**
 * Glyph geometry in normalized units, sized to sit inside Android's maskable
 * safe circle (radius 0.4 from centre) so the same art works for both purposes.
 */
const GLYPH = {
  baseline: { x0: 0.2, x1: 0.8, y0: 0.735, y1: 0.775, radius: 0.018 },
  bars: [
    { x0: 0.2425, x1: 0.3775, y0: 0.555, y1: 0.735, radius: 0.028, color: BAR_MUTED },
    { x0: 0.4325, x1: 0.5675, y0: 0.435, y1: 0.735, radius: 0.028, color: BAR_MID },
    { x0: 0.6225, x1: 0.7575, y0: 0.29, y1: 0.735, radius: 0.028, color: BAR_HIGH },
  ],
};

/** Rounded-rectangle hit test with the short side capping the radius. */
function insideRoundRect(px, py, rect) {
  const r = Math.min(rect.radius ?? 0, (rect.x1 - rect.x0) / 2, (rect.y1 - rect.y0) / 2);
  const cx = Math.min(Math.max(px, rect.x0 + r), rect.x1 - r);
  const cy = Math.min(Math.max(py, rect.y0 + r), rect.y1 - r);
  if (px >= rect.x0 && px <= rect.x1 && py >= rect.y0 && py <= rect.y1) {
    if (px >= rect.x0 + r && px <= rect.x1 - r) return true;
    if (py >= rect.y0 + r && py <= rect.y1 - r) return true;
    const dx = px - cx;
    const dy = py - cy;
    return dx * dx + dy * dy <= r * r;
  }
  return false;
}

/** Scale the glyph about the icon centre (maskable art needs more breathing room). */
function scaleAboutCenter(value, scale) {
  return 0.5 + (value - 0.5) * scale;
}

function scaledGlyph(scale) {
  const map = (rect) => ({
    x0: scaleAboutCenter(rect.x0, scale),
    x1: scaleAboutCenter(rect.x1, scale),
    y0: scaleAboutCenter(rect.y0, scale),
    y1: scaleAboutCenter(rect.y1, scale),
    radius: (rect.radius ?? 0) * scale,
  });
  return {
    baseline: { ...map(GLYPH.baseline), color: BASELINE },
    bars: GLYPH.bars.map((bar) => ({ ...map(bar), color: bar.color })),
  };
}

/** Colour at a point in normalized units, or null over the background gradient. */
function colorAt(nx, ny, glyph) {
  for (const bar of glyph.bars) {
    if (insideRoundRect(nx, ny, bar)) return bar.color;
  }
  if (insideRoundRect(nx, ny, glyph.baseline)) return glyph.baseline.color;
  return null;
}

const SAMPLES = 3; // 3×3 supersampling

function renderIcon(size, glyphScale) {
  const glyph = scaledGlyph(glyphScale);
  const rgba = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SAMPLES);
  const offset = step / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        const ny = (y * SAMPLES + sy) * step + offset;
        // Vertical background gradient, evaluated once per subsample row.
        const t = Math.min(1, Math.max(0, ny));
        const bg = [
          Math.round(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t),
          Math.round(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t),
          Math.round(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t),
        ];
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const nx = (x * SAMPLES + sx) * step + offset;
          const fg = colorAt(nx, ny, glyph);
          if (fg) {
            r += fg[0];
            g += fg[1];
            b += fg[2];
          } else {
            r += bg[0];
            g += bg[1];
            b += bg[2];
          }
        }
      }
      const samples = SAMPLES * SAMPLES;
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(r / samples);
      rgba[i + 1] = Math.round(g / samples);
      rgba[i + 2] = Math.round(b / samples);
      rgba[i + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

/* ------------------------------------------------------------------ *
 * Output
 * ------------------------------------------------------------------ */

/** Glyph scale per generated size: maskable art is inset further than "any". */
const TARGETS = [
  { file: "icons/icon-192.png", size: 192, glyphScale: 1 },
  { file: "icons/icon-512.png", size: 512, glyphScale: 1 },
  { file: "icons/icon-maskable-512.png", size: 512, glyphScale: 0.88 },
  // iOS reads the `apple-touch-icon` link, and the platform head injector emits
  // `/__grok/icon-180.png` unless that href is already in the document. Writing
  // the same art to both paths means iOS gets the branded icon with exactly one
  // link and no middleware override (see scripts/pwa-manifest.mjs).
  {
    file: "icons/apple-touch-icon-180.png",
    size: Number(APPLE_TOUCH_ICON.sizes.split("x")[0]),
    glyphScale: 1,
  },
  {
    file: "__grok/icon-180.png",
    size: Number(PLATFORM_APPLE_ICON.sizes.split("x")[0]),
    glyphScale: 1,
  },
];

function main() {
  const written = new Set();
  for (const target of TARGETS) {
    const out = join(PUBLIC_DIR, ...target.file.split("/"));
    mkdirSync(dirname(out), { recursive: true });
    const png = renderIcon(target.size, target.glyphScale);
    writeFileSync(out, png);
    written.add(target.file);
    console.log(
      `[pwa-icons] public/${target.file} — ${target.size}×${target.size}, ${png.length} bytes`,
    );
  }

  // The manifest is generated from the same module the tests assert against, so
  // `public/manifest.webmanifest` can never drift from the builder.
  const manifestPath = join(PUBLIC_DIR, "manifest.webmanifest");
  const manifest = renderManifestJson();
  writeFileSync(manifestPath, manifest);
  written.add("manifest.webmanifest");
  console.log(`[pwa-icons] public/manifest.webmanifest — ${manifest.length} bytes`);

  // Fail loudly if the manifest ever references an icon this script does not write.
  const expected = [
    ...PWA_ICONS.map((i) => i.src.replace(/^\//, "")),
    APPLE_TOUCH_ICON.src.replace(/^\//, ""),
    PLATFORM_APPLE_ICON.src.replace(/^\//, ""),
  ];
  for (const file of expected) {
    if (!written.has(file)) {
      console.error(`[pwa-icons] manifest references /${file}, which is not generated`);
      process.exitCode = 1;
    }
  }
}

main();
