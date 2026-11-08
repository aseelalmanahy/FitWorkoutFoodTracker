// Phase 1: the temporary install icons, until the owner approves branding. A plain "FW" on the Slate & Mist accent,
// drawn once and committed, so nothing is drawn at run time. The maskable icon keeps the mark inside the safe zone.
//   node scripts/pwa-icons.cjs
"use strict";
const path = require("node:path");
const sharp = require("sharp");
const OUT = path.join(__dirname, "..", "public", "icons");
const svg = (size, inset) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" ${inset ? "" : 'rx="22"'} fill="#4a6a90"/>
  <text x="50" y="${inset ? 59 : 61}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="${inset ? 28 : 38}" fill="#ffffff" letter-spacing="-1">FW</text>
</svg>`;
(async () => {
  for (const [name, size, inset] of [["icon-192.png", 192, false], ["icon-512.png", 512, false], ["maskable-512.png", 512, true], ["apple-touch-icon.png", 180, true]]) {
    await sharp(Buffer.from(svg(size, inset))).png().toFile(path.join(OUT, name));
  }
  console.log("icons written");
})();
