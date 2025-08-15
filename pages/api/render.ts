// pages/api/render.ts
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

// Optional HEIC/HDR normalizer (loaded only if installed)
let sharp: any = null;
try { sharp = require("sharp"); } catch { /* optional */ }

// ---------- Owner / Pro ----------
const OWNER_EMAIL = "grigoriskleanthous@gmail.com";
function envProEmails(): Set<string> {
  const s = (process.env.PRO_EMAILS || "")
    .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  return new Set(s);
}
async function isProEmail(email: string) {
  const e = (email || "").toLowerCase();
  if (!e) return false;
  if (e === OWNER_EMAIL.toLowerCase() || envProEmails().has(e)) return true;
  const u = await prisma.user.findUnique({ where: { email: e }, select: { isPro: true } });
  return !!u?.isPro;
}

// ---------- Tunables ----------
const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const PRESET = "veryfast";
const CRF = "23";
const SWS = "bicubic+accurate_rnd+full_chroma_int";

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
    p.on("close", code => code === 0 ? resolve(out || err) : reject(new Error(`${bin} exited ${code}\n${err}`)));
  });
}
function runFF(args: string[]) {
  const bin = (ffmpegPath as string) || process.env.FFMPEG_PATH || "ffmpeg";
  // make ffmpeg quieter and with fewer threads to reduce RAM spikes
  return run(bin, ["-hide_banner", "-threads", "1", "-loglevel", "warning", ...args]);
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
    if (mime.endsWith("heic") || mime.endsWith("heif")) return ".jpg";
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

// Try to convert HEIC/HEIF to JPEG using sharp (if installed)
async function normalizeStillIfNeeded(pth: string): Promise<string> {
  const ext = path.extname(pth).toLowerCase();
  if (!sharp) return pth;
  if (ext !== ".heic" && ext !== ".heif") return pth;
  const out = pth.replace(/\.(heic|heif)$/i, ".jpg");
  try {
    await sharp(pth).jpeg({ quality: 92 }).toFile(out);
    return out;
  } catch {
    return pth; // if sharp can't, fall back to original
  }
}

function saveIncomingItem(tmpDir: string, item: any, i: number): Promise<string> | string {
  if (item?.dataUrl) {
    const { mime, buf } = decodeDataURL(item.dataUrl);
    if (!buf?.length) throw new Error("bad_data_url");
    const ext = guessExt(item.name, mime);
    const out = path.join(tmpDir, `in-${i}${ext}`);
    fs.writeFileSync(out, buf);
    if (ext === ".heic" || ext === ".heif") return normalizeStillIfNeeded(out);
    return out;
  }
  if (item?.url) {
    let src = item.url as string;
    if (src.startsWith("/")) src = path.join(process.cwd(), "public", src);
    const ext = guessExt(item.name, item.mime);
    const out = path.join(tmpDir, `in-${i}${ext}`);
    fs.copyFileSync(src, out);
    if (ext === ".heic" || ext === ".heif") return normalizeStillIfNeeded(out);
    return out;
  }
  throw new Error("missing_input");
}

// ---------- Legacy usage (file-based) ----------
const DATA_DIR = path.join(process.cwd(), "data");
const USAGE_FILE = path.join(DATA_DIR, "usage.json");
const RENDERS_FILE = path.join(DATA_DIR, "renders.json");
function readJSON<T = any>(file: string, fallback: T): T {
  try { ensureDir(DATA_DIR); if (!fs.existsSync(file)) return fallback; return JSON.parse(fs.readFileSync(file, "utf8") || "null") ?? fallback; }
  catch { return fallback; }
}
function writeJSON(file: string, data: any) { try { ensureDir(DATA_DIR); fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8"); } catch {} }
function getCount(email: string): number { const m = readJSON<Record<string, number>>(USAGE_FILE, {}); return m[email.toLowerCase()] || 0; }
function bumpCount(email: string) { const key = email.toLowerCase(); const m = readJSON<Record<string, number>>(USAGE_FILE, {}); m[key] = (m[key] || 0) + 1; writeJSON(USAGE_FILE, m); }
function recordRender(email: string, url: string, itemsCount: number) {
  const list = readJSON<any[]>(RENTERS_FILE_SAFE ?? RENDERS_FILE, []); // see alias below
  list.push({ email: email.toLowerCase(), url, itemsCount, createdAt: new Date().toISOString() });
  writeJSON(RENTERS_FILE_SAFE ?? RENDERS_FILE, list);
}
// keep old alias for safety (defined AFTER the functions use it to avoid TDZ errors)
const RENTERS_FILE_SAFE = RENDERS_FILE;

// ---------- Math helpers ----------
function even(n: number) { return Math.max(2, Math.floor(n / 2) * 2); }
function fitDims(srcW: number, srcH: number) {
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

// ---------- Smooth Ken-Burns (constant box) ----------
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

  const dims = fitDims(rw, rh);
  const fw = even(dims.fw);
  const fh = even(dims.fh);

  const frames = Math.max(2, Math.round(secondsDur * FPS));
  const maxIdx = frames - 1;

  const DZ = 0.20;
  const zin  = `1.00 + ${DZ.toFixed(2)}*(n/${maxIdx})`;
  const zout = `1.20 - ${DZ.toFixed(2)}*(n/${maxIdx})`;
  const zpan = `1.08`;

  const rotVF =
    rot === 90  ? "transpose=1," :
    rot === 180 ? "transpose=1,transpose=1," :
    rot === 270 ? "transpose=2," : "";

  let fgAnim: string;
  if (kind === "image") {
    if (motion === "zoom_in") {
      fgAnim = `[fg0]scale=w='iw*(${zin})':h='ih*(${zin})':eval=frame,crop=${fw}:${fh}:x='(iw-ow)/2':y='(ih-oh)/2'[fgi]`;
    } else if (motion === "zoom_out") {
      fgAnim = `[fg0]scale=w='iw*(${zout})':h='ih*(${zout})':eval=frame,crop=${fw}:${fh}:x='(iw-ow)/2':y='(ih-oh)/2'[fgi]`;
    } else if (motion === "pan_left") {
      fgAnim = `[fg0]scale=w='iw*(${zpan})':h='ih*(${zpan})':eval=frame,crop=${fw}:${fh}:x='(iw-ow)/2 - (iw-ow)/2*(n/${maxIdx})':y='(ih-oh)/2'[fgi]`;
    } else if (motion === "pan_right") {
      fgAnim = `[fg0]scale=w='iw*(${zpan})':h='ih*(${zpan})':eval=frame,crop=${fw}:${fh}:x='(iw-ow)/2 + (iw-ow)/2*(n/${maxIdx})':y='(ih-oh)/2'[fgi]`;
    } else {
      fgAnim = `[fg0]copy[fgi]`;
    }
  } else {
    fgAnim = `[fg0]copy[fgi]`;
  }

  const fin = 0.25;
  const fout = Math.max(0.25, Math.min(0.6, secondsDur * 0.15));

  const bgBase = useBlur
    ? `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:flags=${SWS},crop=${WIDTH}:${HEIGHT},gblur=sigma=36`
    : `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:flags=${SWS},crop=${WIDTH}:${HEIGHT}`;

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

// ---------- Segments ----------
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
    return `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease:flags=${SWS},pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2`;
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
  // Force SDR-compatible yuv420p + AAC to avoid HDR playback issues
  const vf = `${base},fps=${FPS},format=yuv420p,setsar=1`;
  const args: string[] = ["-y"];
  if (trimToSec && trimToSec > 0) args.push("-t", String(trimToSec));
  args.push("-i", inputPath);

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

  const pro = await isProEmail(email);
  if (!pro) {
    const used = getCount(email);
    if (used >= 1) {
      return res.status(402).json({ ok: false, message: "Free limit reached. Please subscribe to continue." });
    }
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

    const rendersDir = ensureRendersDir();
    const jobId = String(nowTs());
    const jobDir = path.join(rendersDir, `tmp-${jobId}`);
    ensureDir(jobDir);

    // Build segments
    const segPaths: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const inp = await Promise.resolve(saveIncomingItem(jobDir, it, i));
      const ext = path.extname(inp).toLowerCase();
      const seg = path.join(jobDir, `seg-${i}.mp4`);

      if ([".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif"].includes(ext)) {
        await makeImageSegment(inp, seg, seconds(durationSec, 2.5), !!bgBlur, (motion as Motion) || "zoom_in");
      } else {
        await makeVideoSegment(inp, seg, !!keepVideoAudio, !!bgBlur, seconds(maxPerVideoSec, 0) || undefined);
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

    // Cleanup tmp
    try {
      for (const f of segPaths) fs.unlinkSync(f);
      fs.unlinkSync(listPath);
      const leftovers = fs.readdirSync(jobDir);
      for (const f of leftovers) fs.unlinkSync(path.join(jobDir, f));
      fs.rmdirSync(jobDir);
    } catch {}

    // Final sanity check
    if (!fs.existsSync(finalPath)) {
      throw new Error("final_mp4_missing");
    }

    const relUrl = `/renders/${path.basename(finalPath)}`;
    recordRender(email, relUrl, items.length);

    // DB persist + prune latest 20 (best-effort)
    try {
      const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      const anyClient: any = prisma as any;
      if (user && anyClient.render) {
        const stat = fs.statSync(finalPath);
        const fileName = path.basename(finalPath);

        await anyClient.render.create({
          data: { userId: user.id, fileName, url: relUrl, bytes: stat.size },
        });

        const KEEP = 20;
        const toDelete = await anyClient.render.findMany({
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
          await anyClient.render.deleteMany({ where: { id: { in: toDelete.map((r: any) => r.id) } } });
        }
      }
    } catch (dbErr) {
      console.error("RENDER_DB_PERSIST_OR_PRUNE_FAIL", dbErr);
    }

    return res.json({ ok: true, url: relUrl });
  } catch (e: any) {
    console.error("RENDER_FAIL", e?.message || e);
    return res.status(500).json({ ok: false, error: "render_failed", details: e?.message || String(e) });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "150mb" } } };