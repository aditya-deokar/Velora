import { deflateSync, inflateSync } from "node:zlib";

/** SOURCE OF TRUTH: PNG codec helpers, linear-light compositing, export finishing, A/B transitions and overlays (parsePng, encodePng, voidPng, composite, finishLook, applyLut, blendTransition, compositeOverlay, srgbToLinear, linearToSrgb).
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
  if (bitDepth !== 8 || interlace !== 0 || ![0, 2, 4, 6].includes(colorType)) throw new Error("Only 8-bit non-interlaced grayscale/RGB/RGBA PNGs are supported.");
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
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
      else if (colorType === 4) { pixels[o] = pixels[o + 1] = pixels[o + 2] = line[x * 2]; pixels[o + 3] = line[x * 2 + 1]; }
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

// Export finishing: bloom, halation, chromatic aberration, sharpen and a 3D LUT on one finished frame.
// The browser layer (grade, grain, vignette, letterbox) is already in the captured pixels.
export type FinishingLook = {
  bloom?: { threshold: number; intensity: number; radius: number };
  halation?: { amount: number; radius: number };
  chromaticAberration?: number;
  sharpen?: number;
};
export type Lut3d = { size: number; domainMin: [number, number, number]; domainMax: [number, number, number]; table: Float32Array };
// Three box passes approximate a gaussian; separable, on a float plane.
function boxBlur(plane: Float32Array, width: number, height: number, radius: number): Float32Array {
  // Work on a copy: the passes ping-pong between two buffers and must never write into the caller's plane.
  let source: Float32Array = Float32Array.from(plane), target: Float32Array = new Float32Array(plane.length);
  const r = Math.max(1, Math.round(radius / 3));
  for (let pass = 0; pass < 3; pass++) {
    for (const horizontal of [true, false]) {
      const lines = horizontal ? height : width, length = horizontal ? width : height;
      for (let line = 0; line < lines; line++) {
        const at = (i: number) => horizontal ? line * width + i : i * width + line;
        let sum = 0;
        for (let i = -r; i <= r; i++) sum += source[at(Math.min(length - 1, Math.max(0, i)))];
        for (let i = 0; i < length; i++) {
          target[at(i)] = sum / (2 * r + 1);
          sum += source[at(Math.min(length - 1, i + r + 1))] - source[at(Math.max(0, i - r))];
        }
      }
      [source, target] = [target, source];
    }
  }
  return source;
}
/** Apply export finishing to one PNG; returns the input bytes unchanged when nothing applies. */
export function finishLook(png: Buffer, look: FinishingLook | undefined, lut?: Lut3d): Buffer {
  if (!look?.bloom && !look?.halation && !look?.chromaticAberration && !look?.sharpen && !lut) return png;
  const { width, height, pixels } = parsePng(png);
  const count = width * height;
  // Work in linear light.
  const rgb: Float32Array[] = [new Float32Array(count), new Float32Array(count), new Float32Array(count)];
  for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) rgb[c][i] = TO_LINEAR[pixels[i * 4 + c]];
  const glow = (threshold: number, radius: number, gain: [number, number, number]) => {
    const bright = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const luma = 0.2126 * rgb[0][i] + 0.7152 * rgb[1][i] + 0.0722 * rgb[2][i];
      bright[i] = Math.max(0, luma - threshold) / Math.max(1e-6, 1 - threshold);
    }
    const blurred = boxBlur(bright, width, height, radius);
    // Screen blend keeps whites from clipping harshly.
    for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) { const add = blurred[i] * gain[c]; rgb[c][i] = 1 - (1 - rgb[c][i]) * (1 - Math.min(1, add)); }
  };
  if (look?.bloom) glow(look.bloom.threshold, look.bloom.radius, [look.bloom.intensity, look.bloom.intensity, look.bloom.intensity]);
  // Halation: film's red-orange glow around highlights.
  if (look?.halation) glow(0.6, look.halation.radius, [look.halation.amount * 1.1, look.halation.amount * 0.35, look.halation.amount * 0.1]);
  if (look?.chromaticAberration) {
    // Radial: red scales outward, blue inward, by up to `amount` pixels at the corners.
    const amount = look.chromaticAberration, cx = (width - 1) / 2, cy = (height - 1) / 2, reach = Math.hypot(cx, cy) || 1;
    const sample = (plane: Float32Array, x: number, y: number) => {
      const xi = Math.min(width - 1, Math.max(0, Math.round(x))), yi = Math.min(height - 1, Math.max(0, Math.round(y)));
      return plane[yi * width + xi];
    };
    const red = new Float32Array(count), blue = new Float32Array(count);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const dx = x - cx, dy = y - cy, k = amount / reach;
      red[y * width + x] = sample(rgb[0], x - dx * k, y - dy * k);
      blue[y * width + x] = sample(rgb[2], x + dx * k, y + dy * k);
    }
    rgb[0] = red; rgb[2] = blue;
  }
  if (look?.sharpen) {
    for (let c = 0; c < 3; c++) {
      const soft = boxBlur(rgb[c], width, height, 3);
      for (let i = 0; i < count; i++) rgb[c][i] = rgb[c][i] + look.sharpen * (rgb[c][i] - soft[i]);
    }
  }
  const out = Buffer.alloc(count * 4);
  for (let i = 0; i < count; i++) {
    let r = linearToSrgb(rgb[0][i]), g = linearToSrgb(rgb[1][i]), b = linearToSrgb(rgb[2][i]);
    if (lut) [r, g, b] = applyLut(lut, r / 255, g / 255, b / 255).map(value => Math.max(0, Math.min(255, roundHalfEven(value * 255)))) as [number, number, number];
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = pixels[i * 4 + 3];
  }
  return encodePng(width, height, out);
}
/** Trilinear lookup of an sRGB-encoded color in a .cube table (red fastest). */
export function applyLut(lut: Lut3d, r: number, g: number, b: number): [number, number, number] {
  const n = lut.size - 1;
  const coord = (value: number, axis: number) => Math.max(0, Math.min(n, ((value - lut.domainMin[axis]) / (lut.domainMax[axis] - lut.domainMin[axis] || 1)) * n));
  const x = coord(r, 0), y = coord(g, 1), z = coord(b, 2);
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const x1 = Math.min(n, x0 + 1), y1 = Math.min(n, y0 + 1), z1 = Math.min(n, z0 + 1);
  const fx = x - x0, fy = y - y0, fz = z - z0;
  const at = (i: number, j: number, k: number, c: number) => lut.table[((k * lut.size + j) * lut.size + i) * 3 + c];
  return [0, 1, 2].map(c => {
    const c00 = at(x0, y0, z0, c) * (1 - fx) + at(x1, y0, z0, c) * fx, c10 = at(x0, y1, z0, c) * (1 - fx) + at(x1, y1, z0, c) * fx;
    const c01 = at(x0, y0, z1, c) * (1 - fx) + at(x1, y0, z1, c) * fx, c11 = at(x0, y1, z1, c) * (1 - fx) + at(x1, y1, z1, c) * fx;
    return (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
  }) as [number, number, number];
}

// Linear-light float image used by transition blends and overlay compositing (premultiplied alpha).
type LinearImage = { width: number; height: number; r: Float32Array; g: Float32Array; b: Float32Array; a: Float32Array };
function toLinear(png: Buffer): LinearImage {
  const { width, height, pixels } = parsePng(png);
  const count = width * height;
  const image = { width, height, r: new Float32Array(count), g: new Float32Array(count), b: new Float32Array(count), a: new Float32Array(count) };
  for (let i = 0; i < count; i++) {
    const alpha = pixels[i * 4 + 3] / 255;
    image.r[i] = TO_LINEAR[pixels[i * 4]] * alpha; image.g[i] = TO_LINEAR[pixels[i * 4 + 1]] * alpha; image.b[i] = TO_LINEAR[pixels[i * 4 + 2]] * alpha; image.a[i] = alpha;
  }
  return image;
}
function fromLinear(image: LinearImage): Buffer {
  const count = image.width * image.height, out = Buffer.alloc(count * 4);
  let opaque = true;
  for (let i = 0; i < count; i++) {
    const alpha = Math.max(0, Math.min(1, image.a[i]));
    if (alpha > 0) { out[i * 4] = linearToSrgb(image.r[i] / alpha); out[i * 4 + 1] = linearToSrgb(image.g[i] / alpha); out[i * 4 + 2] = linearToSrgb(image.b[i] / alpha); }
    out[i * 4 + 3] = Math.max(0, Math.min(255, roundHalfEven(alpha * 255)));
    if (out[i * 4 + 3] !== 255) opaque = false;
  }
  return encodePng(image.width, image.height, out, { alpha: !opaque });
}
const blank = (width: number, height: number): LinearImage => ({ width, height, r: new Float32Array(width * height), g: new Float32Array(width * height), b: new Float32Array(width * height), a: new Float32Array(width * height) });
const CHANNELS = ["r", "g", "b", "a"] as const;
/** Per-pixel mix of A and B with weight w(x, y) for B. */
function mix(a: LinearImage, b: LinearImage, weight: (x: number, y: number) => number): LinearImage {
  const out = blank(a.width, a.height);
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const i = y * a.width + x, w = Math.max(0, Math.min(1, weight(x, y)));
    for (const c of CHANNELS) out[c][i] = a[c][i] * (1 - w) + b[c][i] * w;
  }
  return out;
}
// Bilinear resample through a destination-to-source mapping; outside the frame is transparent.
function sample(image: LinearImage, transform: (x: number, y: number) => [number, number]): LinearImage {
  const out = blank(image.width, image.height);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const [sx, sy] = transform(x, y);
    if (sx < 0 || sy < 0 || sx > image.width - 1 || sy > image.height - 1) continue;
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(image.width - 1, x0 + 1), y1 = Math.min(image.height - 1, y0 + 1), fx = sx - x0, fy = sy - y0;
    const i = y * image.width + x;
    for (const c of CHANNELS) {
      const p = image[c];
      out[c][i] = (p[y0 * image.width + x0] * (1 - fx) + p[y0 * image.width + x1] * fx) * (1 - fy) + (p[y1 * image.width + x0] * (1 - fx) + p[y1 * image.width + x1] * fx) * fy;
    }
  }
  return out;
}
// Directional box blur (the whip smear) along x or y.
function smear(image: LinearImage, radius: number, horizontal: boolean): LinearImage {
  if (radius < 1) return image;
  const out = blank(image.width, image.height), r = Math.round(radius);
  const lines = horizontal ? image.height : image.width, length = horizontal ? image.width : image.height;
  for (const c of CHANNELS) for (let line = 0; line < lines; line++) {
    const at = (i: number) => horizontal ? line * image.width + i : i * image.width + line;
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += image[c][at(Math.min(length - 1, Math.max(0, i)))];
    for (let i = 0; i < length; i++) {
      out[c][at(i)] = sum / (2 * r + 1);
      sum += image[c][at(Math.min(length - 1, i + r + 1))] - image[c][at(Math.max(0, i - r))];
    }
  }
  return out;
}
export type BlendOptions = { direction?: "left" | "right" | "up" | "down"; seed?: number };
/**
 * Blend outgoing frame A into incoming frame B at progress 0..1 (already eased) in linear light.
 * Progress 0 returns the A bytes and 1 the B bytes for the dissolve family.
 */
export function blendTransition(type: string, pngA: Buffer, pngB: Buffer, progress: number, options: BlendOptions = {}): Buffer {
  const p = Math.max(0, Math.min(1, progress));
  if (p === 0 && (type === "crossfade" || type.startsWith("dip-to-"))) return pngA;
  if (p === 1 && (type === "crossfade" || type.startsWith("dip-to-") || type === "zoom")) return pngB;
  const a = toLinear(pngA), b = toLinear(pngB);
  if (a.width !== b.width || a.height !== b.height) throw new Error("Transition frames must share one size.");
  const { width: W, height: H } = a;
  const direction = options.direction ?? "right";
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "right" || direction === "down" ? 1 : -1;
  const extent = horizontal ? W : H;
  const solid = (value: number): LinearImage => { const image = blank(W, H); image.r.fill(value); image.g.fill(value); image.b.fill(value); image.a.fill(1); return image; };
  const feather = Math.max(2, Math.round(extent * 0.06));
  let out: LinearImage;
  switch (type) {
    case "crossfade": out = mix(a, b, () => p); break;
    case "dip-to-black": case "dip-to-white": {
      const color = solid(type === "dip-to-black" ? 0 : 1);
      out = p < 0.5 ? mix(a, color, () => p * 2) : mix(color, b, () => (p - 0.5) * 2);
      break;
    }
    case "wipe": {
      // The feathered edge travels in `direction`; B is revealed behind it.
      const edge = p * (extent + feather) - feather / 2;
      out = mix(a, b, (x, y) => {
        const coord = horizontal ? (sign > 0 ? x : W - 1 - x) : (sign > 0 ? y : H - 1 - y);
        return (edge - coord) / feather + 0.5;
      });
      break;
    }
    case "iris": {
      const radius = p * (Math.hypot(W / 2, H / 2) + feather);
      out = mix(a, b, (x, y) => (radius - Math.hypot(x - W / 2, y - H / 2)) / feather + 0.5);
      break;
    }
    case "push": {
      // A slides out in `direction` while B follows it in.
      const shift = p * extent;
      const offset = (x: number, y: number, by: number): [number, number] => horizontal ? [x - sign * by, y] : [x, y - sign * by];
      const outgoing = sample(a, (x, y) => offset(x, y, shift));
      const incoming = sample(b, (x, y) => offset(x, y, shift - extent));
      out = mix(outgoing, incoming, (x, y) => incoming.a[y * W + x] > 0 && outgoing.a[y * W + x] === 0 ? 1 : incoming.a[y * W + x] > 0 && outgoing.a[y * W + x] > 0 ? 0.5 : 0);
      break;
    }
    case "zoom": {
      const scale = 1 + 0.6 * p;
      const grown = sample(a, (x, y) => [(x - W / 2) / scale + W / 2, (y - H / 2) / scale + H / 2]);
      out = mix(grown, b, () => p);
      break;
    }
    case "whip": {
      // The smear peaks at the midpoint where the frames swap; each frame travels a third of the frame.
      const blur = Math.sin(Math.PI * p) * extent * 0.08, travel = extent / 3;
      const moved = p < 0.5 ? p * 2 * travel : -(1 - p) * 2 * travel;
      const frame = p < 0.5 ? a : b;
      // Coordinates pulled from outside the frame clamp to its edge, so the smear streaks the edge pixels
      // instead of revealing black or a ghost copy.
      const source = sample(frame, (x, y) => horizontal ? [Math.max(0, Math.min(W - 1, x - sign * moved)), y] : [x, Math.max(0, Math.min(H - 1, y - sign * moved))]);
      out = smear(source, blur, horizontal);
      break;
    }
    case "light-leak": {
      out = mix(a, b, () => p);
      // A warm, seeded glow from one edge, strongest mid-transition, added in linear light.
      let s = ((options.seed ?? 1) >>> 0) || 1;
      const rand = () => { s = (s + 0x6d2b79f5) >>> 0; let m = Math.imul(s ^ (s >>> 15), s | 1); m ^= m + Math.imul(m ^ (m >>> 7), m | 61); return ((m ^ (m >>> 14)) >>> 0) / 4294967296; };
      const cx = rand() < 0.5 ? -0.1 * W : 1.1 * W, cy = (0.2 + 0.6 * rand()) * H, reach = Math.hypot(W, H) * 0.7;
      const strength = Math.sin(Math.PI * p) * 0.9;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, glow = Math.max(0, 1 - Math.hypot(x - cx, y - cy) / reach) ** 2 * strength;
        out.r[i] = Math.min(out.a[i], out.r[i] + glow); out.g[i] = Math.min(out.a[i], out.g[i] + glow * 0.5); out.b[i] = Math.min(out.a[i], out.b[i] + glow * 0.18);
      }
      break;
    }
    default: throw new Error(`Unknown overlap transition: ${type}.`);
  }
  return fromLinear(out);
}
/** Composite an overlay frame (transparent capture) over a base frame in linear light. */
export function compositeOverlay(base: Buffer, top: Buffer, opacity = 1, blend: "normal" | "screen" | "multiply" = "normal"): Buffer {
  if (opacity <= 0) return base;
  const under = toLinear(base), over = toLinear(top);
  if (under.width !== over.width || under.height !== over.height) throw new Error("Overlay frames must match the base frame size.");
  const out = blank(under.width, under.height);
  for (let i = 0; i < under.width * under.height; i++) {
    const alpha = over.a[i] * opacity;
    for (const c of ["r", "g", "b"] as const) {
      // Straight (unpremultiplied) colors for the blend math, premultiplied for the result.
      const t = over.a[i] > 0 ? over[c][i] / over.a[i] : 0, u = under.a[i] > 0 ? under[c][i] / under.a[i] : 0;
      const blended = blend === "screen" ? 1 - (1 - u) * (1 - t) : blend === "multiply" ? u * t : t;
      out[c][i] = under[c][i] * (1 - alpha) + blended * alpha;
    }
    out.a[i] = alpha + under.a[i] * (1 - alpha);
  }
  return fromLinear(out);
}
