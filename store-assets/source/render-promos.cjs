const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'store-assets');
const icon = fs.readFileSync(path.join(root, 'icons/icon128.png')).toString('base64');

const backdrop = `<defs>
  <linearGradient id="background" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#141328"/><stop offset="1" stop-color="#25215a"/></linearGradient>
  <radialGradient id="glow"><stop stop-color="#78edd0" stop-opacity=".11"/><stop offset="1" stop-color="#78edd0" stop-opacity="0"/></radialGradient>
</defs>`;

const small = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280" viewBox="0 0 440 280">
${backdrop}
<rect width="440" height="280" fill="url(#background)"/>
<circle cx="421" cy="271" r="200" fill="url(#glow)"/>
<image x="24" y="23" width="50" height="50" href="data:image/png;base64,${icon}"/>
<g font-family="Arial,Helvetica,sans-serif">
  <text x="86" y="51" fill="#fff" font-size="29" font-weight="700" letter-spacing="-.8">Rolebeam</text>
  <text x="87" y="71" fill="#78edd0" font-size="10" letter-spacing="2">PRIVATE BETA</text>
  <text x="24" y="128" fill="#fff" font-size="31" font-weight="700" letter-spacing="-.8">Find Your Fit.</text>
  <text x="24" y="165" fill="#fff" font-size="31" font-weight="700" letter-spacing="-.8">Apply With Confidence.</text>
  <text x="24" y="202" fill="#d0cfe2" font-size="13">Resume-based ranking. Reviewed applications.</text>
  <text x="24" y="223" fill="#d0cfe2" font-size="13">Manage your Apple Careers submissions.</text>
  <text x="24" y="260" fill="#b3b0cd" font-size="10">Unofficial · Not affiliated with Apple or OpenAI</text>
</g>
</svg>`;

const marquee = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="560" viewBox="0 0 1400 560">
${backdrop}
<rect width="1400" height="560" fill="url(#background)"/>
<ellipse cx="1245" cy="329" rx="480" ry="380" fill="url(#glow)"/>
<image x="72" y="62" width="96" height="96" href="data:image/png;base64,${icon}"/>
<g font-family="Arial,Helvetica,sans-serif">
  <text x="190" y="112" fill="#fff" font-size="48" font-weight="700" letter-spacing="-1.5">Rolebeam</text>
  <text x="192" y="145" fill="#78edd0" font-size="14" letter-spacing="3">PRIVATE BETA · APPLE CAREERS</text>
  <text x="72" y="267" fill="#fff" font-size="62" font-weight="700" letter-spacing="-1.9">Find Your Fit.</text>
  <text x="72" y="341" fill="#fff" font-size="62" font-weight="700" letter-spacing="-1.9">Apply With Confidence.</text>
  <text x="75" y="399" fill="#d0cfe2" font-size="22">Resume-Based Ranking · Reviewed Applications</text>
  <text x="75" y="431" fill="#d0cfe2" font-size="22">Your Apple Careers Submissions, In One Place</text>
  <text x="75" y="510" fill="#b3b0cd" font-size="15">Unofficial assistant. Not affiliated with Apple or OpenAI.</text>
  <g transform="translate(967 139)">
    <rect width="352" height="292" rx="28" fill="#fff" fill-opacity=".04" stroke="#fff" stroke-opacity=".13"/>
    <text x="26" y="41" fill="#b3b0cd" font-size="12" letter-spacing="2">A CLEARER NEXT STEP</text>
    <g transform="translate(23 65)">
      <rect width="306" height="59" rx="13" fill="#fff" fill-opacity=".06"/>
      <rect x="16" y="18" width="7" height="23" rx="3.5" fill="#78edd0"/>
      <text x="39" y="36" fill="#fff" font-size="19" font-weight="600">Match Your Resume</text>
    </g>
    <g transform="translate(23 136)">
      <rect width="306" height="59" rx="13" fill="#fff" fill-opacity=".06"/>
      <rect x="16" y="18" width="7" height="23" rx="3.5" fill="#78edd0" fill-opacity=".72"/>
      <text x="39" y="36" fill="#fff" font-size="19" font-weight="600">Review Your Roles</text>
    </g>
    <g transform="translate(23 207)">
      <rect width="306" height="59" rx="13" fill="#fff" fill-opacity=".06"/>
      <rect x="16" y="18" width="7" height="23" rx="3.5" fill="#78edd0" fill-opacity=".45"/>
      <text x="39" y="36" fill="#fff" font-size="19" font-weight="600">Choose Your Next Move</text>
    </g>
  </g>
</g>
</svg>`;

(async () => {
  fs.copyFileSync(path.join(root, 'icons/icon128.png'), path.join(assets, 'store-icon-128x128.png'));
  for (const [name, svg] of [['promo-small-440x280', small], ['promo-marquee-1400x560', marquee]]) {
    fs.writeFileSync(path.join(__dirname, `${name}.svg`), `${svg}\n`);
    await sharp(Buffer.from(svg)).png().toFile(path.join(assets, `${name}.png`));
  }
  console.log('Rendered Rolebeam promotional images and copied packaged Letterform icon.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
