/**
 * SHA-256 of a string as hex. Plain code, as production-config.ts is also built for the Edge runtime through
 * instrumentation, where node:crypto can't be imported, and WebCrypto's digest is asynchronous. It only compares the
 * notice's text with what was reviewed, and protects no secret. data-inventory.test.ts checks it against node:crypto.
 */
const K = new Uint32Array(64);
const isPrime = (n: number) => { for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; };
for (let n = 2, i = 0; i < 64; n++) {
  if (isPrime(n)) K[i++] = (Math.cbrt(n) % 1) * 2 ** 32;
}
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

export function sha256Hex(text: string): string {
  const message = new TextEncoder().encode(text);
  const length = ((message.length + 9 + 63) >> 6) << 6;
  const data = new Uint8Array(length);
  data.set(message);
  data[message.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(length - 8, Math.floor((message.length * 8) / 2 ** 32));
  view.setUint32(length - 4, (message.length * 8) >>> 0);

  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < length; offset += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(offset + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + w[t]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => { h[i] = (h[i] + v) | 0; });
  }
  return Array.from(h, (v) => v.toString(16).padStart(8, "0")).join("");
}
