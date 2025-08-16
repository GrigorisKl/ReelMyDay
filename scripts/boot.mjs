// scripts/boot.mjs
import fs from "node:fs";
import path from "node:path";

const dataRoot = "/data";
const rendersData = path.join(dataRoot, "renders");
const publicRenders = path.join(process.cwd(), "public", "renders");

try { if (!fs.existsSync(dataRoot)) fs.mkdirSync(dataRoot, { recursive: true }); } catch {}
try { if (!fs.existsSync(rendersData)) fs.mkdirSync(rendersData, { recursive: true }); } catch {}

try {
  if (fs.existsSync(publicRenders)) {
    const stat = fs.lstatSync(publicRenders);
    if (stat.isSymbolicLink()) fs.unlinkSync(publicRenders);
    else fs.rmSync(publicRenders, { recursive: true, force: true });
  }
} catch {}

try {
  fs.symlinkSync(rendersData, publicRenders, "dir");
  console.log("Symlinked /data/renders -> public/renders");
} catch (e) {
  console.log("Symlink failed, falling back to local public/renders:", e?.message);
  if (!fs.existsSync(publicRenders)) fs.mkdirSync(publicRenders, { recursive: true });
}