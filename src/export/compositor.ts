import { deflateSync, inflateSync } from "node:zlib";

/** SOURCE OF TRUTH: PNG codec helpers and linear-light frame compositing (parsePng, encodePng, voidPng, composite, srgbToLinear, linearToSrgb).
 * WHAT: a minimal PNG decoder/encoder for Chromium screenshots and a compositor that averages
 * motion-blur sub-frames and box-downscales supersampled captures in linear light (premultiplied
 * alpha), rounding half to even back to 8-bit sRGB.
 * WHY: averaging in sRGB darkens edges; FFmpeg tmix/scale would make stills and video diverge.
 * One Node path serves `velora render`, `velora export` and `velora shot`, so a frame is a frame.
 * WHERE: export/services re-exports the codec; export/commands composites captured samples.
 */
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, body, tail]);
}
/** Encode RGBA pixels; fully opaque images are written as RGB (smaller, same pixels). */
export function encodePng(width: number, height: number, rgba: Buffer, options: { alpha?: boolean } = {}): Buffer {
  if (rgba.length !== width * height * 4) throw new Error("Pixel buffer does not match the frame size.");
  let alpha = options.alpha;
  if (alpha === undefined) { alpha = false; for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { alpha = true; break; } }
  const channels = alpha ? 4 : 3;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1) + 1;
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4, target = row + x * channels;
      raw[target] = rgba[source]; raw[target + 1] = rgba[source + 1]; raw[target + 2] = rgba[source + 2];
      if (alpha) raw[target + 3] = rgba[source + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([SIGNATURE, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw, { level: 6 })), pngChunk("IEND", Buffer.alloc(0))]);
}
/** A black (or fully transparent) frame for timeline gaps. */
export function voidPng(width: number, height: number, transparent = false): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 3840 || height > 3840)
    throw new Error("Void frame dimensions must be integers within 1..3840.");
  const channels = transparent ? 4 : 3;
  const raw = Buffer.alloc((width * channels + 1) * height);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = transparent ? 6 : 2;
  return Buffer.concat([SIGNATURE, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}
// Minimal decoder: 8-bit non-interlaced RGB/RGBA/grayscale, the exact shapes Chromium screenshots
// produce. Anything else fails closed with an honest diagnostic instead of guessing.
export function parsePng(png: Buffer): { width: number; height: number; pixels: Buffer } {
  if (png.length < 33 || !png.subarray(0, 8).equals(SIGNATURE)) throw new Error("Not a PNG file.");
  let offset = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = -1, interlace = 1;
  const idat: Buffer[] = [];
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (!width || !height) throw new Error("PNG is missing its IHDR.");
  if (bitDepth !== 8 || interlace !== 0 || ![0, 2, 6].includes(colorType)) throw new Error("Only 8-bit non-interlaced grayscale/RGB/RGBA PNGs are supported.");
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== (stride + 1) * height) throw new Error("PNG scanline size does not match its IHDR.");
  const pixels = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  let position = 0;
  const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[position++];
    const line = Buffer.from(raw.subarray(position, position + stride));
    position += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = previous[x], c = x >= channels ? previous[x - channels] : 0;
      line[x] = (line[x] + (filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? paeth(a, b, c) : 0)) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 6) { pixels[o] = line[x * 4]; pixels[o + 1] = line[x * 4 + 1]; pixels[o + 2] = line[x * 4 + 2]; pixels[o + 3] = line[x * 4 + 3]; }
      else if (colorType === 2) { pixels[o] = line[x * 3]; pixels[o + 1] = line[x * 3 + 1]; pixels[o + 2] = line[x * 3 + 2]; pixels[o + 3] = 255; }
      else { pixels[o] = pixels[o + 1] = pixels[o + 2] = line[x]; pixels[o + 3] = 255; }
    }
    previous = line;
  }
  return { width, height, pixels };
}

// IEC 61966-2-1 sRGB transfer, tabulated for the 256 encoded levels.
const TO_LINEAR = Float64Array.from({ length: 256 }, (_, v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
export function srgbToLinear(value: number): number { return TO_LINEAR[value]; }
function roundHalfEven(value: number): number {
  const floor = Math.floor(value), fraction = value - floor;
  if (fraction > 0.5 + 1e-9) return floor + 1;
  if (fraction < 0.5 - 1e-9) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}
export function linearToSrgb(linear: number): number {
  const c = linear <= 0 ? 0 : linear >= 1 ? 1 : linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, roundHalfEven(c * 255)));
}
/**
 * Average sub-frames (motion blur) and box-downscale by an integer factor (supersampling), both in
 * linear light with premultiplied alpha. One frame at factor 1 returns the input bytes unchanged.
 */
export function composite(pngs: readonly Buffer[], factor = 1): Buffer {
  if (!pngs.length) throw new Error("Compositing needs at least one frame.");
  if (!Number.isInteger(factor) || factor < 1 || factor > 4) throw new Error("Downscale factor must be an integer from 1 to 4.");
  if (pngs.length === 1 && factor === 1) return pngs[0];
  const first = parsePng(pngs[0]);
  const { width, height } = first;
  if (width % factor || height % factor) throw new Error(`Supersampled frame ${width}x${height} is not divisible by ${factor}.`);
  const count = width * height;
  const sum = new Float64Array(count * 4); // premultiplied linear r,g,b and alpha
  let opaque = true;
  pngs.forEach((png, index) => {
    const { pixels, width: w, height: h } = index === 0 ? first : parsePng(png);
    if (w !== width || h !== height) throw new Error("Sub-frames must share one frame size.");
    for (let i = 0; i < count; i++) {
      const o = i * 4, a = pixels[o + 3] / 255;
      if (pixels[o + 3] !== 255) opaque = false;
      sum[o] += TO_LINEAR[pixels[o]] * a; sum[o + 1] += TO_LINEAR[pixels[o + 1]] * a; sum[o + 2] += TO_LINEAR[pixels[o + 2]] * a; sum[o + 3] += a;
    }
  });
  const outWidth = width / factor, outHeight = height / factor;
  const out = Buffer.alloc(outWidth * outHeight * 4);
  const weight = pngs.length * factor * factor;
  for (let y = 0; y < outHeight; y++) for (let x = 0; x < outWidth; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) {
      const o = ((y * factor + dy) * width + x * factor + dx) * 4;
      r += sum[o]; g += sum[o + 1]; b += sum[o + 2]; a += sum[o + 3];
    }
    const t = (y * outWidth + x) * 4;
    const alpha = a / weight;
    if (alpha > 0) { out[t] = linearToSrgb(r / a); out[t + 1] = linearToSrgb(g / a); out[t + 2] = linearToSrgb(b / a); }
    out[t + 3] = opaque ? 255 : Math.max(0, Math.min(255, roundHalfEven(alpha * 255)));
  }
  return encodePng(outWidth, outHeight, out, { alpha: !opaque });
}
