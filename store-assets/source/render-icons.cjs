const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

// icon128.svg is the canonical, hand-authored Letterform geometry.
// Run with sharp available on NODE_PATH, then run render-promos.cjs.
const root = path.resolve(__dirname, '../..');
const icons = path.join(root, 'icons');
const source = fs.readFileSync(path.join(icons, 'icon128.svg'), 'utf8');

(async () => {
  for (const size of [16, 48, 128]) {
    const svg = source.replace('width="128" height="128"', `width="${size}" height="${size}"`);
    fs.writeFileSync(path.join(icons, `icon${size}.svg`), svg);
    await sharp(Buffer.from(svg)).resize(size, size).png().toFile(path.join(icons, `icon${size}.png`));
  }
  fs.copyFileSync(path.join(icons, 'icon128.png'), path.join(root, 'store-assets/store-icon-128x128.png'));
  console.log('Rendered Rolebeam Letterform icons at 16, 48, and 128 pixels.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
