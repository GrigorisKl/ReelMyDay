import fs from "node:fs/promises";
import sharp from "sharp";
import toIco from "to-ico";

await fs.mkdir("public/icons", { recursive: true });
const svg = await fs.readFile("public/favicon.svg");

// PNG sizes
const sizes = [16, 32, 48, 180, 192, 512];
for (const s of sizes) {
  const out = await sharp(svg).resize(s, s).png().toBuffer();
  await fs.writeFile(`public/icons/icon-${s}.png`, out);
}

// favicon.ico (16/32/48)
const ico = await toIco([
  await sharp(svg).resize(16, 16).png().toBuffer(),
  await sharp(svg).resize(32, 32).png().toBuffer(),
  await sharp(svg).resize(48, 48).png().toBuffer(),
]);
await fs.writeFile("public/favicon.ico", ico);

console.log("✔ Icons generated in public/icons and public/favicon.ico");