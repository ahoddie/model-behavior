// Read single entries out of a remote zip with HTTP range requests, so a 1 GB archive costs only the bytes of the
// entries we need. Handles plain and zip64 archives, stored and deflated entries.
import { inflateRawSync } from "node:zlib";
import { politeFetch } from "./ingest.ts";

export type ZipEntry = { name: string; method: number; csize: number; usize: number; offset: number };

async function range(url: string, start: number, end: number): Promise<Buffer> {
  const res = await politeFetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(5 * 60_000) });
  if (res.status !== 206) throw new Error(`range ${start}-${end} on ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function listZip(url: string): Promise<ZipEntry[]> {
  const head = await politeFetch(url, { method: "HEAD" });
  const size = Number(head.headers.get("content-length"));
  if (!size) throw new Error(`no content-length for ${url}`);
  const tailLen = Math.min(size, 70_000);
  const tail = await range(url, size - tailLen, size - 1);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("no end of central directory");
  let count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16);
  if (cdOff === 0xffffffff || count === 0xffff) {
    const loc = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]));
    const z64 = await range(url, Number(tail.readBigUInt64LE(loc + 8)), Number(tail.readBigUInt64LE(loc + 8)) + 55);
    count = Number(z64.readBigUInt64LE(32)); cdSize = Number(z64.readBigUInt64LE(40)); cdOff = Number(z64.readBigUInt64LE(48));
  }
  const cd = await range(url, cdOff, cdOff + cdSize - 1);
  const out: ZipEntry[] = [];
  for (let p = 0, i = 0; i < count && p < cd.length; i++) {
    const method = cd.readUInt16LE(p + 10);
    let csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
    const nlen = cd.readUInt16LE(p + 28), xlen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32);
    let offset = cd.readUInt32LE(p + 42);
    const name = cd.toString("utf8", p + 46, p + 46 + nlen);
    // zip64 extra field carries the real sizes and offset when the 32-bit ones are saturated.
    for (let x = p + 46 + nlen; x < p + 46 + nlen + xlen;) {
      const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
      if (id === 1) {
        let q = x + 4;
        if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (offset === 0xffffffff) { offset = Number(cd.readBigUInt64LE(q)); }
      }
      x += 4 + len;
    }
    out.push({ name, method, csize, usize, offset });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

export async function readZipEntry(url: string, e: ZipEntry): Promise<Buffer> {
  const lh = await range(url, e.offset, e.offset + 29);
  const start = e.offset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
  if (e.csize === 0) return Buffer.alloc(0);
  const data = await range(url, start, start + e.csize - 1);
  if (e.method === 0) return data;
  if (e.method === 8) return inflateRawSync(data);
  throw new Error(`zip method ${e.method} not supported (${e.name})`);
}

// The same, for a zip already in memory (a small archive fetched whole).
export function listZipBuffer(buf: Buffer): ZipEntry[] {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("no end of central directory");
  const count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let p = cdOff, i = 0; i < count; i++) {
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    out.push({ name: buf.toString("utf8", p + 46, p + 46 + nlen), method: buf.readUInt16LE(p + 10), csize: buf.readUInt32LE(p + 20),
      usize: buf.readUInt32LE(p + 24), offset: buf.readUInt32LE(p + 42) });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
export function readZipBufferEntry(buf: Buffer, e: ZipEntry): Buffer {
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const data = buf.subarray(start, start + e.csize);
  if (e.method === 0) return data;
  if (e.method === 8) return inflateRawSync(data);
  throw new Error(`zip method ${e.method} not supported (${e.name})`);
}
