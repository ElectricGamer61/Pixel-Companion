#!/usr/bin/env node
//
// Render the app icons from the companion's own sprite data.
//
//   npm run build:main && node scripts/generate-icons.mjs
//
// Writes build/icon.png (512x512, used by the Linux and macOS targets) and
// build/icon.ico (16..256, used by the Windows executable and the desktop
// shortcut). Both are committed, so this only needs re-running when the sprite
// changes.
//
// The art is `BODY` + the `happy` face from src/shared/sprite.ts, scaled by
// whole numbers so every icon size stays pixel-crisp. Nothing is downloaded,
// no image library is involved, and there is no paid or cloud tooling: the PNG
// and ICO containers are written here directly on top of Node's zlib.

import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

// The sprite is TypeScript, so this reads the CommonJS build of it rather than
// re-implementing the art in a second place where the two could drift.
const COMPILED_SPRITE = join(PROJECT_DIR, 'dist-electron/src/shared/sprite.js');
let sprite;
try {
  sprite = require(COMPILED_SPRITE);
} catch {
  console.error(
    `generate-icons: ${COMPILED_SPRITE} is missing.\n` +
      `Run 'npm run build:main' first — the icons are rendered from the compiled sprite.`,
  );
  process.exit(1);
}

const { PALETTE, SPRITE_SIZE, composeFrame } = sprite;
const GRID = composeFrame('happy');

/** Icon sizes Windows Explorer, the taskbar, and Alt-Tab actually ask for. */
const ICO_SIZES = [16, 32, 48, 64, 128, 256];
const PNG_SIZE = 512;

/** `#rrggbb` to a packed RGBA tuple. */
function rgba(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
    255,
  ];
}

/** Below this, a padded sprite is too small to read, so it fills the box. */
const MIN_FILL_RATIO = 0.75;

/**
 * How big to draw the sprite inside a `size` box, and where to start.
 *
 * Every scale is a whole number, so one sprite pixel is always an exact block
 * of device pixels: nearest-neighbour by construction, no resampling, no soft
 * edges. Large icons get roughly a sprite pixel of breathing room on each side
 * — the convention every desktop icon follows — but small ones fill the box,
 * because at 16 and 32 pixels legibility beats margins.
 */
function placement(size) {
  const roomy = SPRITE_SIZE * Math.floor((size - 2 * Math.floor(size / SPRITE_SIZE)) / SPRITE_SIZE);
  const inner = roomy >= size * MIN_FILL_RATIO ? roomy : size;
  if (inner % SPRITE_SIZE !== 0) {
    throw new Error(`icon size ${size} is not a whole multiple of ${SPRITE_SIZE}`);
  }
  return { scale: inner / SPRITE_SIZE, offset: (size - inner) / 2 };
}

/** Rasterise the sprite into RGBA at `size` pixels square. */
function raster(size) {
  const { scale, offset } = placement(size);
  const out = Buffer.alloc(size * size * 4); // zero-filled: transparent
  for (let y = 0; y < SPRITE_SIZE; y += 1) {
    for (let x = 0; x < SPRITE_SIZE; x += 1) {
      const key = GRID[y][x];
      if (key === '.') continue;
      const color = PALETTE[key];
      if (!color) continue;
      const [r, g, b, a] = rgba(color);
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const px = offset + x * scale + dx;
          const py = offset + y * scale + dy;
          const at = (py * size + px) * 4;
          out[at] = r;
          out[at + 1] = g;
          out[at + 2] = b;
          out[at + 3] = a;
        }
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ PNG -- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Minimal 8-bit RGBA PNG: one IHDR, one IDAT, no filtering. */
function encodePng(pixels, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  // 10..12 stay 0: deflate, adaptive filtering, no interlace.

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type "none"
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ ICO -- */

/**
 * A 32-bit BGRA DIB, which is what an .ico entry holds below 256x256.
 *
 * The header claims double the real height because an icon DIB is a colour
 * image stacked on top of a 1-bit AND mask, and the rows run bottom-up.
 */
function encodeDib(pixels, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12); // planes
  header.writeUInt16LE(32, 14); // bits per pixel

  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const source = (size - 1 - y) * size * 4;
    for (let x = 0; x < size; x += 1) {
      const from = source + x * 4;
      const to = (y * size + x) * 4;
      xor[to] = pixels[from + 2]; // B
      xor[to + 1] = pixels[from + 1]; // G
      xor[to + 2] = pixels[from]; // R
      xor[to + 3] = pixels[from + 3]; // A
    }
  }

  // The AND mask is legacy, but rows are padded to 4 bytes and shells still
  // read it, so spell out "fully transparent where alpha is zero".
  const maskStride = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(maskStride * size);
  for (let y = 0; y < size; y += 1) {
    const source = (size - 1 - y) * size * 4;
    for (let x = 0; x < size; x += 1) {
      if (pixels[source + x * 4 + 3] === 0) {
        and[y * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  return Buffer.concat([header, xor, and]);
}

function encodeIco(sizes) {
  const images = sizes.map((size) => {
    const pixels = raster(size);
    // 256x256 is PNG-compressed by convention; anything larger than 255 cannot
    // even be expressed in the directory entry as a raw DIB.
    return { size, data: size >= 256 ? encodePng(pixels, size) : encodeDib(pixels, size) };
  });

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size; // 0 means 256
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; // palette colours
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map(({ data }) => data)]);
}

/* ----------------------------------------------------------------- write -- */

const pngPath = join(PROJECT_DIR, 'build/icon.png');
const icoPath = join(PROJECT_DIR, 'build/icon.ico');

writeFileSync(pngPath, encodePng(raster(PNG_SIZE), PNG_SIZE));
writeFileSync(icoPath, encodeIco(ICO_SIZES));

console.log(`generate-icons: wrote ${pngPath} (${PNG_SIZE}x${PNG_SIZE})`);
console.log(`generate-icons: wrote ${icoPath} (${ICO_SIZES.join(', ')})`);
