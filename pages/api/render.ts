/* pages/api/render.ts
   Vertical reel renderer (1080x1920) with:
   - SMOOTH Ken-Burns for images using constant foreground box (no jitter)
   - Blurred "cover" background so landscape/portrait never show black bars
   - Video support (optional blur, keep/don’t keep original audio)
   - Optional background music (mp3, looped/trimmed to video)
   - One-free export gating (owner & PRO emails unlimited)
   - Per-user render history in DB (and still writes file-based JSON for compatibility)
   - Auto-prune: keep only latest 20 renders per user (deletes older files + DB rows)

   Requires: npm i ffmpeg-static ffprobe-static
*/

import type { NextApiRequest, NextApiResponse } from "next";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobeMod from "ffprobe-static";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import { prisma } from "../../lib/prisma";

// ---------- Whitelist / Pro ----------
const OWNER_EMAIL = "grigoriskleanthous@gmail.com";
function envProEmails(): Set<string> {
  const s = (process.env.PRO_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set(s);
}
function isWhitelisted(email: string): boolean {
  const e = (email || "").toLowerCase();
  return !!e && (e === OWNER_EMAIL.toLowerCase() || envProEmails().has(e));
}

// ---------- Render Tunables ----------
const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;                  // 60 for even smoother (slower render)
const PRESET = "veryfast";
const CRF = "23";
const SWS = "bicubic+accurate_rnd+full_chroma_int"; // high-quality scaler

// ---------- FS helpers ----------
function ensureDir(p: string) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
function nowTs() { return Date.now(); }
function seconds(n?: any, def = 3) { const v = Number(n); return Number.isFinite(v) && v > 0 ? v : def; }
const fwd = (p: string) => p.replace(/\\/g, "/");

function run(bin: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd, windowsHide: true });
    let out = ""; let err = "";
    p.stdout.on("data", d => out += d.toString());
    p.stderr.on("data", d => err += d.toString());
    p.on("close", code => code === 0 ? resolve(out || err) : reject(new Error(`${bin} exited with ${code}\n${err}`)));
  });
}
function runFF(args: string[]) {
  const bin = (ffmpegPath as string) || process.env.FFMPEG_PATH || "ffmpeg";
  return run(bin, args);
}
function probe(input: string): Promise<{ width: number; height: number; rotation: number }> {
  const ffprobePath = (ffprobeMod as any)?.path || (ffprobeMod as any) || "ffprobe";
  const args = [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height:stream_tags=rotate",
    "-of", "json",
    input
  ];
  return run(ffprobePath, args).then(json => {
    try {
      const o = JSON.parse(json || "{}");
      const s = (o.streams && o.streams[0]) || {};
      const w = Number(s.width) || WIDTH;
      const h = Number(s.height) || HEIGHT;
      const r = Number((s.tags && s.tags.rotate) || 0) || 0;
      return { width: w, height: h, rotation: r };
    } catch {
      return { width: WIDTH, height: HEIGHT, rotation: 0 };
    }
  });
}

function guessExt(name?: string, mime?: string) {
  if (mime?.startsWith("image/")) {
    if (mime.endsWith("png")) return ".png";
    if (mime.endsWith("jpeg") || mime.endsWith("jpg")) return ".jpg";
    if (mime.endsWith("webp")) return ".webp";
    return ".png";
  }
  if (mime?.startsWith("video/")) {
    if (mime.endsWith("mp4")) return ".mp4";
    if (mime.endsWith("quicktime")) return ".mov";
    if (mime.endsWith("webm")) return ".webm";
    return ".mp4";
  }
  if (mime?.startsWith("audio/")) return ".mp3";
  if (name) {
    const ext = path.extname(name);
    if (ext) return ext;
  }
  return ".bin";
}
function decodeDataURL(data?: string): { mime: string; buf?: Buffer } {
  if (!data) return { mime: "" };
  const m = /^data:(.+?);base64,(.+)$/i.exec(data);
  if (!m) return { mime: "", buf: undefined };
  return { mime: m[1], buf: Buffer.from(m[2], "base64") };
}
function ensureRendersDir() {
  const pub = path.join(process.cwd(), "public");
  ensureDir(pub);
  const renders = path.join(pub, "renders");
  ensureDir(renders);
  return renders;
}
function saveIncomingItem(tmpDir: string, item: any, i: number): string {
  if (item?.dataUrl) {
    const { mime, buf } = decodeDataURL(item.dataUrl);
    if (!buf?.length) throw new Error("bad_data_url");
    const ext = guessExt(item.name, mime);
    const out = path.join(tmpDir, `in-${i}${ext}`);
    fs.writeFileSync(out, buf);
    return out;
  }
  if (item?.url) {
    let src = item.url as string;
    if (src.startsWith("/")) src = path.join(process.cwd(), "public", src);
    const ext = guessExt(item.name, item.mime);
    const out = path.join(tmpDir, `in-${i}${ext}`);
    fs.copyFileSync(src, out);
    return out;
  }
  throw new Error("missing_input");
}

// ---------- Usage & History (file-based, kept for compatibility) ----------
const DATA_DIR = path.join(process.cwd(), "data");
const USAGE_FILE = path.join(DATA_DIR, "usage.json");
const RENDERS_FILE = path.join(DATA_DIR, "renders.json");
function readJSON<T = any>(file: string, fallback: T): T {
  try {
    ensureDir(DATA_DIR);
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8") || "null") ?? fallback;
  } catch { return fallback; }
}
function writeJSON(file: string, data: any) {
  try { ensureDir(DATA_DIR); fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8"); } catch {}
}
function getCount(email: string): number {
  const m = readJSON<Record<string, number>>(USAGE_FILE, {});
  return m[email.toLowerCase()] || 0;
}
function bumpCount(email: string) {
  const key = email.toLowerCase();
  const m = readJSON<Record<string, number>>(USAGE_FILE, {});
  m[key] = (m[key] || 0) + 1;
  writeJSON(USAGE_FILE, m);
}
function recordRender(email: string, url: string, itemsCount: number) {
  const list = readJSON<any[]>(RENDERS_FILE, []);
  list.push({ email: email.toLowerCase(), url, itemsCount, createdAt: new Date().toISOString() });
  writeJSON(RENDERS_FILE, list);
}

// ---------- Math helpers ----------
function even(n: number) { return Math.max(2, Math.floor(n / 2) * 2); }
function fitDims(srcW: number, srcH: number) {
  // contain into WIDTH x HEIGHT
  const arSrc = srcW / srcH;
  const arOut = WIDTH / HEIGHT;
  if (arSrc >= arOut) {
    const fw = WIDTH;
    const fh = even(Math.round(WIDTH / arSrc));
    return { fw, fh };
  } else {
    const fh = HEIGHT;
    const fw = even(Math.round(HEIGHT * arSrc));
    return { fw, fh };
  }
}

type Motion = "zoom_in" | "zoom_out" | "pan_left" | "pan_right" | "cover";
type Kind = "image" | "video";

// ---------- Constant-box Ken-Burns (no jitter) ----------
/**
 * Build per-clip filter (contain + blurred bg + SMOOTH zoom/pan inside a fixed box)
 * - Foreground box stays constant (no jitter); zoom/pan is scale+crop inside it.
 * - No stretch (contain), blurred background fill, setsar=1 everywhere.
 */
function buildContainWithBlurVF(
  kind: Kind,
  secondsDur: number,
  motion: Motion,
  rot: number,
  srcW: number,
  srcH: number,
  useBlur: boolean
) {
  const rotated = rot === 90 || rot === 270;
  const rw = rotated ? srcH : srcW;
  const rh = rotated ? srcW : srcH;

  // Foreground "contain" size inside 1080x1920 (constant for the whole segment)
  const dims = fitDims(rw, rh);
  const fw = even(dims.fw);
  const fh = even(dims.fh);

  // Animation timing
  const frames = Math.max(2, Math.round(secondsDur * FPS));
  const maxIdx = frames - 1;

  // Zoom factors (>=1 to avoid invalid crops)
  const DZ = 0.20; // 20% total zoom range
  const zin  = `1.00 + ${DZ.toFixed(2)}*(n/${maxIdx})`;     // 1.00 -> 1.20
  const zout = `1.20 - ${DZ.toFixed(2)}*(n/${maxIdx})`;     // 1.20 -> 1.00
  const zpan = `1.08`;                                      // headroom for pans

  // Optional rotation
  const rotVF =
    rot === 90  ? "transpose=1," :
    rot === 180 ? "transpose=1,transpose=1," :
    rot === 270 ? "transpose=2," : "";

  // Foreground pipeline in two stages:
  //   [fg0] = contain to (fw x fh) once (constant size)
  //   then per-frame: scale by z and crop back to fw x fh to simulate zoom OR pan
  let fgAnim: string;
  if (kind === "image") {
    if (motion === "zoom_in") {
      fgAnim =
        `[fg0]scale=w='iw*(${zin})':h='ih*(${zin})':eval=frame,` +
        `crop=${fw}:${fh}:x='(iw-ow)/2':y='(ih-oh)/2'[fgi]`;
    } else if (motion === "zoom_out") {
      fgAnim =
        `[fg0]scale=w='iw*(${zout})':h='ih*(${zout})':eval=frame,` +
        `crop=${fw}:${fh}:x='(iw-ow)/2':y='(ih-oh)/2'[fgi]`;
    } else if (motion === "pan_left") {
      fgAnim =
        `[fg0]scale=w='iw*(${zpan})':h='ih*(${zpan})':eval=frame,` +
        `crop=${fw}:${fh}:x='(iw-ow)/2 - (iw-ow)/2*(n/${maxIdx})':y='(ih-oh)/2'[fgi]`;
    } else if (motion === "pan_right") {
      fgAnim =
        `[fg0]scale=w='iw*(${zpan})':h='ih*(${zpan})':eval=frame,` +
        `crop=${fw}:${fh}:x='(iw-ow)/2 + (iw-ow)/2*(n/${maxIdx})':y='(ih-oh)/2'[fgi]`;
    } else {
      fgAnim = `[fg0]copy[fgi]`;
    }
  } else {
    // For video clips, keep it simple and stable (no per-frame scale)
    fgAnim = `[fg0]copy[fgi]`;
  }

  // Fades
  const fin = 0.25;
  const fout = Math.max(0.25, Math.min(0.6, secondsDur * 0.15));

  // Background (blurred cover fill) or plain cover if blur disabled
  const bgBase = useBlur
    ? `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:flags=${SWS},crop=${WIDTH}:${HEIGHT},gblur=sigma=36`
    : `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:flags=${SWS},crop=${WIDTH}:${HEIGHT}`;

  // Full graph (overlay box is constant -> no jitter)
  const vf =
    `${rotVF}setsar=1,split=2[bg][fg];` +
    `[bg]${bgBase},setsar=1[bg];` +
    `[fg]scale=${fw}:${fh},setsar=1[fg0];` +
    `${fgAnim};` +
    `[bg][fgi]overlay=x='(W-w)/2':y='(H-h)/2',` +
    `fade=t=in:st=0:d=${fin},` +
    `fade=t=out:st=${(secondsDur - fout).toFixed(2)}:d=${fout},` +
    `fps=${FPS},format=yuv420p`;

  return vf;
}

// ---------- Segment builders ----------
async function makeImageSegment(
  inputPath: string,
  outPath: string,
  durSec: number,
  bgBlur: boolean,
  motion: Motion
) {
  const info = await probe(inputPath);
  const vf = buildContainWithBlurVF("image", durSec, motion, info.rotation, info.width, info.height, bgBlur !== false);

  const args = [
    "-y",
    "-loop", "1",
    "-framerate", String(FPS),
    "-t", String(durSec),
    "-i", inputPath,
    // add silent stereo so concat works
    "-f", "lavfi", "-t", String(durSec), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-filter_complex", vf + "[v]",
    "-map", "[v]",
    "-map", "1:a",
    "-c:v", "libx264", "-preset", PRESET, "-crf", CRF, "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "160k",
    "-shortest",
    outPath,
  ];
  await runFF(args);
}

function baseFitVideo(bgBlur: boolean): string {
  if (!bgBlur) {
    return `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease:flags=${SWS},` +
           `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2`;
  }
  return [
    `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease:flags=${SWS}[fit]`,
    `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:flags=${SWS},crop=${WIDTH}:${HEIGHT},gblur=sigma=36[bg]`,
    `[bg][fit]overlay=(W-w)/2:(H-h)/2`,
  ].join(";");
}
async function makeVideoSegment(
  inputPath: string,
  outPath: string,
  keepAudio: boolean,
  bgBlur: boolean,
  trimToSec?: number
) {
  const base = baseFitVideo(bgBlur);
  const vf = `${base},fps=${FPS},format=yuv420p,setsar=1`;
  const args: string[] = ["-y", "-i", inputPath];
  if (trimToSec && trimToSec > 0) args.unshift("-t", String(trimToSec));

  if (keepAudio) {
    args.push(
      "-filter_complex", `[0:v]${vf}[v]`,
      "-map", "[v]", "-map", "0:a?",
      "-c:v", "libx264", "-preset", PRESET, "-crf", CRF, "-pix_fmt", "yuv420p", "-r", String(FPS),
      "-c:a", "aac", "-ac", "2", "-ar", "44100", "-b:a", "160k",
      "-shortest",
      outPath
    );
  } else {
    args.push(
      "-f", "lavfi", "-t", trimToSec ? String(trimToSec) : "9999", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-filter_complex", `[0:v]${vf}[v]`,
      "-map", "[v]", "-map", "1:a",
      "-c:v", "libx264", "-preset", PRESET, "-crf", CRF, "-pix_fmt", "yuv420p", "-r", String(FPS),
      "-c:a", "aac", "-ac", "2", "-ar", "44100", "-b:a", "160k",
      "-shortest",
      outPath
    );
  }
  await runFF(args);
}

// ---------- Concat + music ----------
async function writeConcatListAbsolute(fileList: string[], listPath: string) {
  const lines = fileList.map((abs) => `file '${fwd(path.resolve(abs))}'`).join("\n");
  fs.writeFileSync(listPath, lines, "utf8");
}
async function concatSegments(listPath: string, outPath: string) {
  await runFF(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath]);
}
async function replaceAudioWithMusic(videoPath: string, musicPath: string): Promise<string> {
  const mixedPath = videoPath.replace(/\.mp4$/i, "-music.mp4");
  const args = [
    "-y",
    "-stream_loop", "-1", "-i", musicPath,
    "-i", videoPath,
    "-map", "1:v:0",
    "-map", "0:a:0",
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "192k",
    "-shortest",
    mixedPath,
  ];
  await runFF(args);
  return mixedPath;
}

// ---------- Handler ----------
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const session = (await getServerSession(req, res, authOptions as any)) as Session | null;
  const email = session?.user?.email || null;
  if (!email) return res.status(401).json({ ok: false, message: "Please sign in to export." });

  // 1 free export unless whitelisted/Pro
  if (!isWhitelisted(email)) {
    const used = getCount(email);
    if (used >= 1) return res.status(402).json({ ok: false, message: "Free limit reached. Please subscribe to continue." });
  }

  try {
    const {
      items = [],
      durationSec = 2.5,
      maxPerVideoSec = 0,
      keepVideoAudio = true,
      bgBlur = true,
      motion = "zoom_in",
      bgMusicUrl = "",
    } = (req.body || {}) as {
      items: Array<{ name?: string; mime?: string; dataUrl?: string; url?: string }>;
      durationSec?: number; maxPerVideoSec?: number;
      keepVideoAudio?: boolean; bgBlur?: boolean; motion?: Motion;
      bgMusicUrl?: string;
    };

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: "no_items" });
    }

    // Prepare output dirs
    const rendersDir = ensureRendersDir();
    const jobId = String(nowTs());
    const jobDir = path.join(rendersDir, `tmp-${jobId}`);
    ensureDir(jobDir);

    // Build each segment
    const segPaths: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const inputPath = saveIncomingItem(jobDir, it, i);
      const ext = path.extname(inputPath).toLowerCase();
      const seg = path.join(jobDir, `seg-${i}.mp4`);

      if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
        await makeImageSegment(inputPath, seg, seconds(durationSec, 2.5), !!bgBlur, (motion as Motion) || "zoom_in");
      } else {
        await makeVideoSegment(inputPath, seg, !!keepVideoAudio, !!bgBlur, seconds(maxPerVideoSec, 0) || undefined);
      }
      segPaths.push(seg);
    }

    // Concat
    const listPath = path.join(jobDir, "concat.txt");
    await writeConcatListAbsolute(segPaths, listPath);

    const outName = `reel-${jobId}.mp4`;
    const outPath = path.join(rendersDir, outName);
    await concatSegments(listPath, outPath);

    // Optional background music (only if not keeping original video audio)
    let finalPath = outPath;
    if (bgMusicUrl && !keepVideoAudio) {
      let musicAbs = bgMusicUrl;
      if (musicAbs.startsWith("/")) musicAbs = path.join(process.cwd(), "public", musicAbs);
      finalPath = await replaceAudioWithMusic(outPath, musicAbs);
      try { fs.unlinkSync(outPath); } catch {}
    }

    // Cleanup temp
    try {
      for (const f of segPaths) fs.unlinkSync(f);
      fs.unlinkSync(listPath);
      const leftovers = fs.readdirSync(jobDir);
      for (const f of leftovers) fs.unlinkSync(path.join(jobDir, f));
      fs.rmdirSync(jobDir);
    } catch {}

    // Gating counter
    if (!isWhitelisted(email)) bumpCount(email);

    const relUrl = `/renders/${path.basename(finalPath)}`;
    recordRender(email, relUrl, items.length); // legacy JSON list

    // --- Persist in DB + prune per-user to latest 20 (guarded if model isn't generated yet) ---
    try {
      const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      const p: any = prisma as any; // cast to access .render even if types aren't regenerated yet

      if (user && p.render) {
        const stat = fs.statSync(finalPath);
        const fileName = path.basename(finalPath);

        // Save DB row
        await p.render.create({
          data: {
            userId: user.id,
            fileName,
            url: relUrl,
            bytes: stat.size,
          },
        });

        // Keep only latest 20, delete older (DB + files)
        const KEEP = 20;
        const toDelete = await p.render.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          skip: KEEP,
          select: { id: true, fileName: true },
        });

        if (toDelete.length) {
          for (const r of toDelete) {
            const pth = path.join(rendersDir, r.fileName);
            try { fs.unlinkSync(pth); } catch {}
          }
          await p.render.deleteMany({
            where: { id: { in: toDelete.map((r: any) => r.id) } },
          });
        }
      } else if (user && !p.render) {
        console.warn("Render model not available on Prisma client yet; skipping DB persist/prune.");
      }
    } catch (dbErr) {
      console.error("RENDER_DB_PERSIST_OR_PRUNE_FAIL", dbErr);
      // don't fail the render if DB hiccups
    }

    return res.json({ ok: true, url: relUrl });
  } catch (e: any) {
    console.error("RENDER_FAIL", e?.message || e);
    return res.status(500).json({ ok: false, error: "render_failed", details: e?.message || String(e) });
  }
}

// allow large image dataURLs
export const config = { api: { bodyParser: { sizeLimit: "150mb" } } };