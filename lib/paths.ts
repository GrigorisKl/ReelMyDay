import fs from "fs";
import path from "path";
export const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
export const RENDER_DIR = path.join(process.cwd(), "public", "renders");
export function ensureDirs() { for (const p of [UPLOAD_DIR, RENDER_DIR]) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); } }
