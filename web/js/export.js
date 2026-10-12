/**
 * export.js — height-field export.
 *
 * PNG8   : 8-bit grayscale, one byte per pixel (largest exact integer that fits).
 * PNG16  : true 16-bit grayscale, big-endian samples, hand-written zlib stream.
 *
 * The 16-bit writer exists because a Float32 height field quantised to 8 bits loses most of
 * its precision, and Gaea's own exports are 16-bit. It uses stored (uncompressed) deflate
 * blocks, so the files are larger than an optimally compressed PNG but bit-exact and
 * dependency-free.
 */

/* ------------------------------------------------------------------ CRC32 / Adler32 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf, start, end) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(buf) {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/* ------------------------------------------------------------------ PNG writer */

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** zlib stream using stored (BTYPE=00) deflate blocks. Deterministic, no compression. */
function zlibStore(raw) {
  const MAX = 65535;
  const blocks = Math.max(1, Math.ceil(raw.length / MAX));
  const out = new Uint8Array(2 + blocks * 5 + raw.length + 4);
  let o = 0;
  out[o++] = 0x78; out[o++] = 0x01; // CMF/FLG: deflate, 32k window, no dict, fastest
  for (let b = 0; b < blocks; b++) {
    const start = b * MAX;
    const len = Math.min(MAX, raw.length - start);
    out[o++] = b === blocks - 1 ? 1 : 0; // BFINAL, BTYPE=00 stored
    out[o++] = len & 0xff; out[o++] = (len >>> 8) & 0xff;
    out[o++] = ~len & 0xff; out[o++] = (~len >>> 8) & 0xff;
    out.set(raw.subarray(start, start + len), o);
    o += len;
  }
  const ad = adler32(raw);
  out[o++] = (ad >>> 24) & 0xff; out[o++] = (ad >>> 16) & 0xff;
  out[o++] = (ad >>> 8) & 0xff; out[o++] = ad & 0xff;
  return out.subarray(0, o);
}

function pngEncode(width, height, bitDepth, raw) {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = bitDepth;   // 8 or 16
  ihdr[9] = 0;          // colour type 0 = greyscale
  ihdr[10] = 0;         // compression
  ihdr[11] = 0;         // filter
  ihdr[12] = 0;         // no interlace
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', zlibStore(raw)), chunk('IEND', new Uint8Array(0))];
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/* ------------------------------------------------------------------ field -> PNG */

/** Normalise a field into 0..1 using explicit bounds (or the field's own min/max). */
export function normalizeField(field, min, max, invert = false) {
  const n = field.size * field.size;
  const out = new Float32Array(n);
  const src = field.data;
  const stride = field.channels || 1;
  let lo = min, hi = max;
  if (lo === undefined || hi === undefined) {
    lo = Infinity; hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = src[i * stride];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  const span = hi - lo;
  const k = span > 1e-12 ? 1 / span : 0;
  for (let i = 0; i < n; i++) {
    let t = (src[i * stride] - lo) * k;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    out[i] = invert ? 1 - t : t;
  }
  return { data: out, size: field.size, lo, hi };
}

/**
 * Encode the field as a greyscale PNG.
 * @param {object} field  Float32 field
 * @param {object} opts   { bitDepth: 8|16, min, max, invert }
 * @returns {Uint8Array}
 */
export function fieldToPNG(field, opts = {}) {
  const bitDepth = opts.bitDepth === 16 ? 16 : 8;
  const size = field.size;
  const { data } = normalizeField(field, opts.min, opts.max, opts.invert);
  // Each scanline: 1 filter byte + size * bytesPerSample
  const bytesPerSample = bitDepth / 8;
  const stride = 1 + size * bytesPerSample;
  const raw = new Uint8Array(stride * size);
  if (bitDepth === 16) {
    for (let y = 0; y < size; y++) {
      const ro = y * stride;
      raw[ro] = 0;
      for (let x = 0; x < size; x++) {
        const v = Math.round(data[y * size + x] * 65535);
        raw[ro + 1 + x * 2] = (v >>> 8) & 0xff;
        raw[ro + 2 + x * 2] = v & 0xff;
      }
    }
  } else {
    for (let y = 0; y < size; y++) {
      const ro = y * stride;
      raw[ro] = 0;
      for (let x = 0; x < size; x++) raw[ro + 1 + x] = Math.round(data[y * size + x] * 255);
    }
  }
  return pngEncode(size, size, bitDepth, raw);
}

/** Convenience: render the field through a colour ramp and return a PNG blob. */
export function fieldToColorPNG(field, paintFn, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  paintFn(img);
  ctx.putImageData(img, 0, 0);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

/** Trigger a browser download for a byte array or blob. */
export function download(data, filename, mime = 'image/png') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return blob.size;
}

/** Serialise the graph as pretty JSON (for the "save graph" affordance). */
export function graphToJSON(graph) {
  return JSON.stringify(graph, null, 2);
}
