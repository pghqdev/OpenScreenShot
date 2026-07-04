// Generates the extension icons (16/48/128 px) from a single SVG source.
// Run with: npm run icons
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const outDir = 'public/icons';

/**
 * A camera + page silhouette mark on a blue gradient rounded square.
 * Matches the design spec: recognizable at small sizes, distinct from GoFullPage.
 */
function svg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0A84FF"/>
      <stop offset="1" stop-color="#0071E3"/>
    </linearGradient>
  </defs>
  <rect x="6" y="6" width="116" height="116" rx="28" fill="url(#bg)"/>
  <!-- page silhouette behind the camera -->
  <rect x="42" y="30" width="50" height="64" rx="6" fill="#ffffff" opacity="0.32"/>
  <!-- camera body -->
  <rect x="34" y="52" width="60" height="42" rx="10" fill="#ffffff"/>
  <rect x="50" y="45" width="28" height="11" rx="4" fill="#ffffff"/>
  <!-- lens -->
  <circle cx="64" cy="73" r="13" fill="#0071E3"/>
  <circle cx="64" cy="73" r="6.5" fill="#0A84FF"/>
  <circle cx="60" cy="69" r="2.8" fill="#ffffff" opacity="0.85"/>
</svg>`;
}

await mkdir(outDir, { recursive: true });

for (const size of [16, 48, 128]) {
  await sharp(Buffer.from(svg())).png().toFile(`${outDir}/icon${size}.png`);
  console.log(`✓ generated ${outDir}/icon${size}.png`);
}

console.log('Icons generated.');