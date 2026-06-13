/**
 * @fileoverview Dev script: renders media/icon.png (256x256) for the Marketplace
 * listing. Uses the same artwork as media/sidebar.svg but with explicit brand
 * colors and a dark rounded background (sidebar.svg uses currentColor, which
 * would rasterize black-on-transparent).
 *
 * Usage: npm run make:icon
 */

const path = require('path');

// Same paths as media/sidebar.svg, recolored for a standalone icon.
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <rect x="0" y="0" width="24" height="24" rx="5" fill="#1e1e1e"/>
  <g fill="none" stroke="#e0a86a" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="9.5" cy="13.5" r="7"/>
    <path d="M9.5 10v7M7.4 11.6h3.1a1.6 1.6 0 0 1 0 3.2H8M7.4 14.8h3.4"/>
    <path d="M18 3.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" fill="#e0a86a" stroke="none"/>
  </g>
</svg>`;

async function main() {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    console.error('sharp is not installed. Run: npm install');
    process.exit(1);
  }

  const outPath = path.join(__dirname, '..', 'media', 'icon.png');
  const SIZE = 256;

  // The SVG viewBox is 24px; bump density so the rasterization is crisp at 256px.
  await sharp(Buffer.from(ICON_SVG), { density: 72 * (SIZE / 24) })
    .resize(SIZE, SIZE)
    .png()
    .toFile(outPath);

  console.log('Wrote', outPath, `(${SIZE}x${SIZE})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
