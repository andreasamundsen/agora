import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const SIZE = 256;
const SS = 4;
const W = SIZE * SS;

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function roundedRectSdf(x, y) {
  const half = 108;
  const radius = 44;
  const qx = Math.abs(x - 128) - (half - radius);
  const qy = Math.abs(y - 128) - (half - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - radius;
}

const inkTop = [38, 33, 26];
const inkBottom = [20, 18, 15];
const cream = [244, 239, 228];
const gold = [176, 141, 84];

function sample(x, y) {
  // Rounded tile with a very subtle vertical ink gradient.
  if (roundedRectSdf(x, y) > 0) return [0, 0, 0, 0];

  let color = inkTop.map((v, i) => Math.round(v + ((inkBottom[i] - v) * (y / 256))));
  let alpha = 255;

  // Hairline gold border inside the tile.
  if (roundedRectSdf(x, y) > -2.4) {
    color = gold;
  }

  const legs = Math.min(
    segDist(x, y, 128, 65, 78, 192),
    segDist(x, y, 128, 65, 178, 192)
  );
  const crossbar = segDist(x, y, 98, 147, 158, 147);
  if (legs <= 11 || crossbar <= 8) {
    color = cream;
  }

  if (segDist(x, y, 88, 211, 168, 211) <= 3.2) {
    color = gold;
  }

  return [...color, alpha];
}

const rgba = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const px = (x * SS + sx + 0.5) / SS;
        const py = (y * SS + sy + 0.5) / SS;
        const [cr, cg, cb, ca] = sample(px, py);
        const af = ca / 255;
        r += cr * af;
        g += cg * af;
        b += cb * af;
        a += af;
      }
    }
    const offset = (y * SIZE + x) * 4;
    const count = SS * SS;
    if (a === 0) {
      rgba[offset] = 0;
      rgba[offset + 1] = 0;
      rgba[offset + 2] = 0;
      rgba[offset + 3] = 0;
    } else {
      rgba[offset] = Math.round(r / a);
      rgba[offset + 1] = Math.round(g / a);
      rgba[offset + 2] = Math.round(b / a);
      rgba[offset + 3] = Math.round((a / count) * 255);
    }
  }
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const body = Buffer.concat([name, data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0))
]);

const ico = Buffer.alloc(22 + png.length);
ico.writeUInt16LE(0, 0);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico[6] = 0; // 256 px
ico[7] = 0;
ico[8] = 0;
ico[9] = 0;
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);
png.copy(ico, 22);

fs.mkdirSync("build", { recursive: true });
fs.writeFileSync(path.join("build", "icon.png"), png);
fs.writeFileSync(path.join("build", "icon.ico"), ico);
console.log(`Wrote build/icon.png (${png.length} bytes) and build/icon.ico (${ico.length} bytes)`);
