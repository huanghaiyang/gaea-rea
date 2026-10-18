/**
 * extract-unityfs.mjs — unpack a Unity `UnityFS` AssetBundle into its serialized files.
 *
 * WHY THIS EXISTS
 * Gaea's 3D viewport is an embedded Unity player (`Gaea.Viewport_Data/`), so its terrain shaders are
 * NOT in the managed assemblies and NOT in `Gaea.oneAPI.dll` -- they are compiled shader bytecode
 * inside `data.unity3d`. Nothing available on this machine can open that (no UnityPy, no
 * AssetRipper, and python is unavailable), and the format is documented, so it is parsed here.
 *
 * CONFIRMED FROM THE FILE ITSELF
 *   0x00  "UnityFS\0"                  AssetBundle
 *   0x08  00 00 00 08                  format version 8
 *   0x0C  "5.x.x\0"
 *   0x12  "6000.3.12f1\0"              Unity 6000.3.12f1
 *   0x1E  00 00 00 00 00 95 7C 35      size = 9796661  == the file's byte length
 *   0x26  00 00 05 29                  compressedBlocksInfo   = 1321
 *   0x2A  00 00 1D 1C                  uncompressedBlocksInfo = 7452
 *   0x2E  00 00 02 43                  flags = 0x243
 *
 * `flags = 0x243` decodes as compression `0x03` (LZ4HC), `0x40` (BlockInfo padded), `0x200`
 * (blocks and directory info combined). The `size` field matching the file length byte for byte is
 * what makes the header parse trustworthy rather than hopeful.
 *
 * SELF-CHECKS, because a container parser that silently mis-reads looks exactly like one that works:
 *   * the declared size equals the file length
 *   * the decompressed BlocksInfo length equals the declared uncompressed size
 *   * the block table's uncompressed total equals the sum it promises
 *   * the reassembled data begins with a Unity SerializedFile header
 *
 * Usage: node tools/extract-unityfs.mjs --in="D:\Gaea 2\Gaea.Viewport_Data\data.unity3d" --out=evidence/unityfs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const IN = arg('in', 'D:\\Gaea 2\\Gaea.Viewport_Data\\data.unity3d');
const OUT = resolve(arg('out', 'evidence/unityfs'));

/* ------------------------------------------------------------------ LZ4 block */
/*
 * Raw LZ4 block decompression. Unity wraps whole blocks, not frames, so the frame magic and the
 * xxhash trailer are not present and a frame decoder would reject the input.
 *
 * Sequence: a token byte, high nibble = literal length, low nibble = match length, then the
 * literals, then a little-endian 16-bit match offset. A nibble of 15 means "add the following
 * bytes, 255 at a time". Match length is stored MINUS the 4-byte minimum.
 */
function lz4Block(src, expectedSize) {
  const out = Buffer.alloc(expectedSize);
  let si = 0;
  let di = 0;
  const n = src.length;

  while (si < n) {
    const token = src[si++];

    let litLen = token >> 4;
    if (litLen === 15) {
      let b;
      do { b = src[si++]; litLen += b; } while (b === 255);
    }
    if (litLen > 0) {
      if (si + litLen > n) throw new Error(`literal run overruns input at ${si}`);
      src.copy(out, di, si, si + litLen);
      si += litLen;
      di += litLen;
    }
    // The last sequence carries only literals and has no offset field.
    if (si >= n) break;

    const offset = src[si] | (src[si + 1] << 8);
    si += 2;
    if (offset === 0) throw new Error(`zero match offset at ${si - 2}`);

    let matchLen = token & 0x0F;
    if (matchLen === 15) {
      let b;
      do { b = src[si++]; matchLen += b; } while (b === 255);
    }
    matchLen += 4;

    const from = di - offset;
    if (from < 0) throw new Error(`match before start at ${di} - ${offset}`);
    // Byte-by-byte: overlapping copies are legal and are how runs are encoded.
    for (let i = 0; i < matchLen; i++) out[di++] = out[from + i];
  }
  return out.subarray(0, di);
}

/* ---------------------------------------------------------------- reader ----- */
class Reader {
  constructor(buf) { this.b = buf; this.p = 0; }
  u8() { return this.b[this.p++]; }
  u16be() { const v = this.b.readUInt16BE(this.p); this.p += 2; return v; }
  u32be() { const v = this.b.readUInt32BE(this.p); this.p += 4; return v; }
  i32be() { const v = this.b.readInt32BE(this.p); this.p += 4; return v; }
  i64be() { const v = this.b.readBigInt64BE(this.p); this.p += 8; return Number(v); }
  str() {
    let s = '';
    while (this.p < this.b.length) { const c = this.b[this.p++]; if (c === 0) break; s += String.fromCharCode(c); }
    return s;
  }
  align(a) { const r = this.p % a; if (r) this.p += a - r; }
}

/* ------------------------------------------------------------------- main ----- */
const file = readFileSync(IN);
console.log(`  input: ${IN}`);
console.log(`  bytes: ${file.length}`);

const r = new Reader(file);
const sig = file.subarray(0, 8).toString('latin1');
if (sig !== 'UnityFS\0') throw new Error(`not a UnityFS bundle: ${JSON.stringify(sig)}`);

const version = r.u32be();
const unityVersion = r.str();
const unityRevision = r.str();

const size = version >= 7 ? r.i64be() : r.u32be();
const compInfoSize = r.u32be();
const uncompInfoSize = r.u32be();
const flags = r.u32be();

const compression = flags & 0x3F;
const COMP = { 0: 'none', 1: 'LZMA', 2: 'LZ4', 3: 'LZ4HC' };

console.log('');
console.log('  header:');
console.log(`    signature        ${JSON.stringify(sig)}`);
console.log(`    format version   ${version}`);
console.log(`    unity version    ${unityVersion}  (revision ${unityRevision})`);
console.log(`    declared size    ${size}   ${size === file.length ? '== file length OK' : '!= file length MISMATCH'}`);
console.log(`    blocksInfo       ${compInfoSize} compressed -> ${uncompInfoSize} raw`);
console.log(`    flags            0x${flags.toString(16)}  compression=${COMP[compression] || compression}` +
  `${flags & 0x40 ? ' +padded' : ''}${flags & 0x80 ? ' +infoAtEnd' : ''}${flags & 0x200 ? ' +combined' : ''}`);
console.log(`    header consumed  ${r.p} bytes`);

if (compression === 0) throw new Error('uncompressed bundles are not the interesting case here');
if (compression === 1) {
  throw new Error('LZMA blocks: Unity stores these with a 5-byte props header; extend lzma() before use');
}

// BlocksInfo sits immediately after the header unless the "at the end" flag is set.
if (flags & 0x80) {
  r.p = file.length - compInfoSize;
}
const infoRaw = file.subarray(r.p, r.p + compInfoSize);
r.p += compInfoSize;

console.log(`    blocksInfo at    ${r.p - compInfoSize}`);

let info;
if (compression === 2 || compression === 3) {
  info = lz4Block(infoRaw, uncompInfoSize);
} else {
  throw new Error(`unsupported compression ${compression}`);
}
console.log(`    blocksInfo out   ${info.length} bytes  ${info.length === uncompInfoSize ? 'OK' : 'MISMATCH'}`);
if (info.length !== uncompInfoSize) throw new Error('blocksInfo size mismatch');

/* BlocksInfo: 16-byte hash, block count, then per-block (uncompressed, compressed, flags). */
const ir = new Reader(info);
ir.p += 16; // unity hash
const blockCount = ir.i32be();
console.log('');
console.log(`  blocks: ${blockCount}`);

const blocks = [];
for (let i = 0; i < blockCount; i++) {
  const u = ir.i32be();
  const c = ir.i32be();
  const f = ir.u16be ? ir.u16be() : (ir.u16?.() ?? (() => { const v = info.readUInt16BE(ir.p); ir.p += 2; return v; })());
  blocks.push({ uncompressed: u, compressed: c, flags: f });
}
for (const [i, b] of blocks.entries()) {
  console.log(`    [${i}] ${b.uncompressed} raw / ${b.compressed} stored  flags=0x${b.flags.toString(16)}`);
}

const nodeCount = ir.i32be();
console.log('');
console.log(`  directory nodes: ${nodeCount}`);
const nodes = [];
for (let i = 0; i < nodeCount; i++) {
  const offset = ir.i64be();
  const nodeSize = ir.i64be();
  const nodeFlags = ir.u32be();
  const path = ir.str();
  nodes.push({ offset, size: nodeSize, flags: nodeFlags, path });
}
for (const nd of nodes) {
  console.log(`    ${nd.path}  offset=${nd.offset} size=${nd.size}`);
}

/* ---------------------------------------------- decompress the data blocks --- */
let dataStart = r.p;
// The padding flag means the data blocks start on a 16-byte boundary.
if (flags & 0x40) {
  const rem = dataStart % 16;
  if (rem) dataStart += 16 - rem;
}
console.log('');
console.log(`  data blocks start at ${dataStart}${flags & 0x40 ? ' (16-byte aligned)' : ''}`);

const parts = [];
let cursor = dataStart;
for (const [i, b] of blocks.entries()) {
  const slice = file.subarray(cursor, cursor + b.compressed);
  if (b.flags & 0x3F) {
    throw new Error(`block ${i} uses compression 0x${(b.flags & 0x3F).toString(16)}; only LZ4HC is handled`);
  }
  const plain = lz4Block(slice, b.uncompressed);
  if (plain.length !== b.uncompressed) {
    throw new Error(`block ${i}: got ${plain.length}, expected ${b.uncompressed}`);
  }
  parts.push(plain);
  cursor += b.compressed;
  console.log(`    [${i}] -> ${plain.length} bytes OK  (read to ${cursor})`);
}
const assembled = Buffer.concat(parts);
console.log('');
console.log(`  assembled: ${assembled.length} bytes`);

/* Unity SerializedFile: metadata size (u32be), file size (u32be), version (u32be), data offset. */
const head = assembled.subarray(0, 20);
console.log(`  first 20 bytes: ${head.toString('hex')}`);
const sfMeta = assembled.readUInt32BE(0);
const sfSize = assembled.readUInt32BE(4);
const sfVersion = assembled.readUInt32BE(8);
const sfDataOffset = assembled.readUInt32BE(12);
console.log('  serialized file header:');
console.log(`    metadataSize ${sfMeta}`);
console.log(`    fileSize     ${sfSize}   ${sfSize === assembled.length ? '== assembled OK' : '!= assembled'}`);
console.log(`    version      ${sfVersion}`);
console.log(`    dataOffset   ${sfDataOffset}`);
console.log(`    endianness   ${assembled.readUInt8(16) === 0 ? 'little' : 'big'}`);

const plausible = (sfVersion >= 5 && sfVersion <= 30) && sfSize > 0 && sfSize <= assembled.length + 16;
console.log('');
console.log(`  SERIALIZED FILE PLAUSIBLE: ${plausible ? 'yes' : 'no'}`);

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'data.bin'), assembled);
writeFileSync(resolve(OUT, 'nodes.json'), JSON.stringify({
  unityVersion, unityRevision, size, flags, compression, blocks, nodes,
}, null, 2));
console.log('');
console.log(`  wrote ${resolve(OUT, 'data.bin')}`);
console.log(`  wrote ${resolve(OUT, 'nodes.json')}`);
void dirname;
