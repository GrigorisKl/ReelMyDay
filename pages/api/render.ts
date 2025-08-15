/* pages/api/render.ts
   Vertical reel renderer (1080x1920) with:
   - Smooth Ken-Burns for images (constant foreground box; no jitter)
   - Blurred cover background (no black bars)
   - Video support (optional blur; keep/don’t keep original audio)
   - Optional background music (AUDIO FILES ONLY — mp3, m4a, wav, etc.)
   - Gating: one free export per user unless owner/Pro
   - DB persist of renders + auto-prune to latest 20 per user
   - Persistent disk: writes to /data/renders and ALWAYS copies final mp4 to /public/renders
   - Optional auto-duration: match total length to bgMusic duration for images
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

// -------- owner / pro ----------
const OWNER_EMAIL = "grigoriskleanthous@gmail.com";
function envProEmails(): Set<string> {
  const s = (process.env.PRO_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set(s);
}
async function isProEmail(email: string) {
  const e = (email || "").toLowerCase();
  if (!e) return false;
  if (e === OWNER_EMAIL.toLowerCase() || envProEmails().has(e)) return true;
  const u = await prisma.user.findUnique({ where: { email: e }, select: { isPro: true } });
  return !!u?.isPro;
}

// -------- tunables ----------
const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const PRESET = "veryfast";
const CRF = "23";
const SWS = "bicubic+accurate_rnd+full_chroma_int";
const FFMPEG_THREADS = Number(process.env.FFMPEG_THREADS || "1");
const MAX_LOG = 6000;

// -------- fs helpers ----------
function ensureDir(p: string) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
function nowTs() { return Date.now(); }
function seconds(n?: any, def = 3) { const v = Number(n); return Number.isFinite(v) && v > 0 ? v : def; }
const fwd = (p: string) => p.replace(/\\/g, "/");

// persistent renders root and public path
function getRendersRoot(): { diskRoot: string; publicRoot: string } {
  const diskRoot = fs.existsSync("/data") ? "/data/renders" : path.join(process.cwd(), "public", "renders");
  const publicRoot = path.join(process.cwd(), "public", "renders");
  ensureDir(diskRoot);
  ensureDir(publicRoot);

  // best-effort symlink (harmless if it fails)
  try {
    const isLink = fs.existsSync(publicRoot) && fs.lstatSync(publicRoot).isSymbolicLink();
    const target = isLink ? path.resolve(fs.readlinkSync(publicRoot)) : "";
    if (!isLink || target !== path.resolve(diskRoot)) {
      try { if (fs.existsSync(publicRoot) && !isLink) fs.rmdirSync(publicRoot); } catch {}
      try { fs.symlinkSync(diskRoot, publicRoot, "dir"); } catch {}
    }
  } catch { /* ignore */ }

  return { diskRoot, publicRoot };
}

function run(bin: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd, windowsHide: true });
    let out = "", err = "";
    p.stdout.on("data", d => { out += d.toString(); if (out.length > MAX_LOG) out = out.slice(-MAX_LOG); });
    p.stderr.on("data", d => { err += d.toString(); if (err.length > MAX_LOG) err = err.slice(-MAX_LOG); });
    p.on("close", code => code === 0 ? resolve(out || err) : reject(new Error(`${bin} exited with ${code}\n${err}`)));
  });
}
function runFF(args: string[]) {
  const bin = (ffmpegPath as string) || process.env.FFMPEG_PATH || "ffmpeg";
  const quiet = ["-hide_banner", "-loglevel", "error", "-nostats", "-nostdin"];
  return run(bin, [...quiet, ...args]);
}

// probe helpers
async function ffprobeJson(input: string): Promise<any> {
  const ffprobePath = (ffprobeMod as any)?.path || (ffprobeMod as any) || "ffprobe";
  const args = ["-v", "error", "-show_streams", "-show_format", "-print_format", "json", input];
  try { return JSON.parse(await run(ffprobePath, args) || "{}"); } catch { return {}; }
}
async function probeVideoDims(input: string): Promise<{ width: number; height: number; rotation: number }> {
  const info = await ffprobeJson(input);
  const vs = (info.streams || []).find((s: any) => s.codec_type === "video") || {};
  const w = Number(vs.width) || WIDTH;
  const h = Number(vs.height) || HEIGHT;
  const r = Number((vs.tags && vs.tags.rotate) || 0) || 0;
  return { width: w, height: h, rotation: r };
}
async function probeDurationSec(input: string): Promise<number> {
  const info = await ffprobeJson(input);
  const d = Number(info.format?.duration);
  return Number.isFinite(d) ? d : 0;
}

// image normalisation (fix iPhone HEIC/HDR etc.)
let sharpMod: any = null;
try { sharpMod = require("sharp"); } catch { sharpMod = null; }

const IMAGE_EXTS = [".png",".jpg",".jpeg",".webp",".heic",".heif",".avif",".jxl",".bmp",".tiff"];
function looksLikeImage(p: string) { return IMAGE_EXTS.includes(path.extname(p).toLowerCase()); }

async function normalizeStillToPng(inPath: string, outPath: string) {
  if (!sharpMod) {
    // if sharp missing, just copy; ffmpeg may still read common formats
    fs.copyFileSync(inPath, outPath);
    return;
  }
  await sharpMod(inPath)
    .rotate()                 // honour EXIF orientation
    .resize(3000, 3000, { fit: "inside", withoutEnlargement: true }) // keep memory sane
    .toColourspace("srgb")
    .png({ compressionLevel: 8 })
    .toFile(outPath);
}

async function saveIncomingItem(tmpDir: string, item: any, i: number): Promise<string> {
  // write to tmp
  let out = path.join(tmpDir, `in-${i}`);
  if (item?.dataUrl) {
    const m = /^data:(.+?);base64,(.+)$/i.exec(item.dataUrl || "");
    if (!m) throw new Error("bad_data_url");
    const mime = m[1]; const buf = Buffer.from(m[2], "base64");
    const ext = mime.startsWith("image/") ? ".png"
              : mime.startsWith("video/") ? ".mp4"
              : mime.startsWith("audio/") ? ".mp3" : ".bin";
    out += ext;
    fs.writeFileSync(out, buf);
  } else if (item?.url) {
    let src = String(item.url);
    if (src.startsWith("/")) src = path.join(process.cwd(), "public", src);
    const ext = path.extname(item.name || src) || ".bin";
    out += ext;
    fs.copyFileSync(src, out);
  } else {
    throw new Error("missing_input");
  }

  // normalise stills → PNG so HEIC/HDR don't break ffmpeg
  if (looksLikeImage(out)) {
    const png = path.join(tmpDir, `still-${i}.png`);
    await normalizeStillToPng(out, png);
    return png;
  }
  return out;
}

// legacy usage json (kept)
const DATA_FILE_ROOT = fs.existsSync("/data") ? "/data" : path.join(process.cwd(), "data");
const USAGE_FILE = path.join(DATA_FILE_ROOT, "usage.json");
const RENDERS_LIST_FILE = path.join(DATA_FILE_ROOT, "renders.json");
function readJSON<T = any>(file: string, fallback: T): T {
  try { ensureDir(path.dirname(file)); if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8") || "null") ?? fallback;
  } catch { return fallback; }
}
function writeJSON(file: string, data: any) {
  try { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8"); } catch {}
}
function getCount(email: string): number {
  const m = readJSON<Record<string, number>>(USAGE_FILE, {}); return m[email.toLowerCase()] || 0;
}
function bumpCount(email: string) {
  const key = email.toLowerCase(); const m = readJSON<Record<string, number>>(USAGE_FILE, {});
  m[key] = (m[key] || 0) + 1; writeJSON(USAGE_FILE, m);
}
function recordRender(email: string, url: string, itemsCount: number) {
  const list = readJSON<any[]>(RENDERS_LIST_FILE, []);
  list.push({ email: email.toLowerCase(), url, itemsCount, createdAt: new Date().toISOString() });
  writeJSON(RENDERS_LIST_FILE, list);
}

// ---------- math ----------
function even(n: number) { return Math.max(2, Math.floor(n / 2) * 2); }
function fitDims(srcW: number, srcH: number) {
  const arSrc = srcW / srcH, arOut = WIDTH / HEIGHT;
  if (arSrc >= arOut) {
    const fw = WIDTH, fh = even(Math.round(WIDTH / arSrc));
    return { fw, fh };
  } else {
    const fh = HEIGHT, fw = even(Math.round(HEIGHT * arSrc));
    return { fw, fh };
  }
}

type Motion = "zoom_in" | "zoom_out" | "pan_left" | "pan_right" | "cover";
type Kind = "image" | "video";

// ---------- smooth ken-burns ----------
function buildContainWithBlurVF(
  kind: Kind, secondsDur: number, motion: Motion, rot: number, srcW: number, srcH: number, useBlur: boolean
) {
  const rotated = rot === 90 || rot === 270;
  const rw = rotated ? srcH : srcW;
  const rh = rotated ? srcW : srcH;
  const dims = fitDims(rw, rh);
  const fw = even(dims.fw), fh = even(dims.fh);

  const frames = Math.max(2, Math.round(secondsDur * FPS));
  const maxIdx = frames - 1;

  const DZ = 0.20;
  const zin  = `1.00 + ${DZ.toFixed(2)}*(n/${maxIdx})`;
  const zout = `1.20 - ${DZ.toFixed(2)}*(n/${maxIdx})`;
  const zpan = `1.08`;

  const rotVF = rot === 90 ? "transpose=1," : rot === 180 ? "transpose=1,transpose=1," : rot === 270 ? "transpose=2," : "";

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

// ---------- segments ----------
async function makeImageSegment(inputPath: string, outPath: string, durSec: number, bgBlur: boolean, motion: Motion) {
  const info = await probeVideoDims(inputPath);
  const vf = buildContainWithBlurVF("image", durSec, motion, info.rotation, info.width, info.height, bgBlur !== false);
  const args = [
    "-y",
    "-loop", "1", "-framerate", String(FPS), "-t", String(durSec),
    "-i", inputPath,
    "-f", "lavfi", "-t", String(durSec), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-filter_complex", vf + "[v]",
    "-map", "[v]", "-map", "1:a",
    "-c:v", "libx264", "-preset", PRESET, "-crf", CRF, "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-threads", String(Math.max(1, FFMPEG_THREADS)),
    "-c:a", "aac", "-b:a", "160k",
    "-shortest", outPath,
  ];
  await runFF(args);
}

function baseFitVideo(bgBlur: boolean): string {
  if (!bgBlur) {
    return `split=1[vx];[vx]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease:flags=${SWS},pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2`;
  }
  return [
    `split=2[vfit][vbg]`,
    `[vfit]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease:flags=${SWS}[fit]`,
    `[vbg]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:flags=${SWS},crop=${WIDTH}:${HEIGHT},gblur=sigma=36[bg]`,
    `[bg][fit]overlay=(W-w)/2:(H-h)/2`,
  ].join(";");
}

async function makeVideoSegment(
  inputPath: string, outPath: string, keepAudio: boolean, bgBlur: boolean, trimToSec?: number
) {
  const base = baseFitVideo(bgBlur);
  const vf = `[0:v]${base},fps=${FPS},format=yuv420p,setsar=1[v]`;
  const args: string[] = ["-y"];
  if (trimToSec && trimToSec > 0) args.push("-t", String(trimToSec));
  args.push("-i", inputPath);

  if (keepAudio) {
    args.push(
      "-filter_complex", vf,
      "-map", "[v]", "-map", "0:a?",
      "-c:v", "libx264", "-preset", PRESET, "-crf", CRF, "-pix_fmt", "yuv420p", "-r", String(FPS),
      "-threads", String(Math.max(1, FFMPEG_THREADS)),
      "-c:a", "aac", "-ac", "2", "-ar", "44100", "-b:a", "160k",
      "-shortest", outPath
    );
  } else {
    args.push(
      "-f", "lavfi", "-t", trimToSec ? String(trimToSec) : "9999", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-filter_complex", vf,
      "-map", "[v]", "-map", "1:a",
      "-c:v", "libx264", "-preset", PRESET, "-crf", CRF, "-pix_fmt", "yuv420p", "-r", String(FPS),
      "-threads", String(Math.max(1, FFMPEG_THREADS)),
      "-c:a", "aac", "-ac", "2", "-ar", "44100", "-b:a", "160k",
      "-shortest", outPath
    );
  }
  await runFF(args);
}

// create concat list
async function writeConcatListAbsolute(fileList: string[], listPath: string) {
  const lines = fileList.map((abs) => `file '${fwd(path.resolve(abs))}'`).join("\n");
  fs.writeFileSync(listPath, lines, "utf8");
}
async function concatSegments(listPath: string, outPath: string) {
  await runFF(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath]);
}

// strictly audio music only (reject video sources)
async function validateMusicIsAudio(musicPath: string) {
  const info = await ffprobeJson(musicPath);
  const hasVideo = (info.streams || []).some((s: any) => s.codec_type === "video");
  const hasAudio = (info.streams || []).some((s: any) => s.codec_type === "audio");
  if (!hasAudio || hasVideo) throw new Error("music_must_be_audio");
}

async function replaceAudioWithMusic(videoPath: string, musicPath: string): Promise<string> {
  await validateMusicIsAudio(musicPath); // will throw if not pure audio
  const mixedPath = videoPath.replace(/\.mp4$/i, "-music.mp4");
  const args = [
    "-y",
    "-i", videoPath,   // 0: video (and maybe audio, but we replace)
    "-stream_loop", "-1", "-i", musicPath, // 1: pure audio
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "192k",
    "-shortest",
    mixedPath,
  ];
  await runFF(args);
  return mixedPath;
}

// ---------- handler ----------
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
      matchMusicDuration = false, // NEW: adjust per-image durations to match music length
    } = (req.body || {}) as {
      items: Array<{ name?: string; mime?: string; dataUrl?: string; url?: string }>;
      durationSec?: number; maxPerVideoSec?: number;
      keepVideoAudio?: boolean; bgBlur?: boolean; motion?: Motion;
      bgMusicUrl?: string; matchMusicDuration?: boolean;
    };

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: "no_items" });
    }

    const { diskRoot, publicRoot } = getRendersRoot();
    const jobId = String(nowTs());
    const jobDir = path.join(diskRoot, `tmp-${jobId}`);
    ensureDir(jobDir);

    // Save + normalise inputs
    const inputPaths: string[] = [];
    for (let i = 0; i < items.length; i++) {
      inputPaths.push(await saveIncomingItem(jobDir, items[i], i));
    }

    // If matching music duration: compute durations for images
    let perImageDur = seconds(durationSec, 2.5);
    let videoTrim = seconds(maxPerVideoSec, 0) || undefined;

    if (matchMusicDuration && bgMusicUrl) {
      let musicAbs = bgMusicUrl;
      if (musicAbs.startsWith("/")) musicAbs = path.join(process.cwd(), "public", musicAbs);
      await validateMusicIsAudio(musicAbs); // ensure it is audio

      const musicLen = await probeDurationSec(musicAbs); // seconds
      if (musicLen > 0) {
        // total length of videos (after trim)
        let totalVid = 0;
        const imgIdx: number[] = [];
        for (let i = 0; i < inputPaths.length; i++) {
          const p = inputPaths[i];
          if (looksLikeImage(p)) {
            imgIdx.push(i);
          } else {
            const d = await probeDurationSec(p);
            totalVid += Math.min(d || 0, videoTrim || d || 0);
          }
        }
        const remain = Math.max(0, musicLen - totalVid);
        const nImgs = imgIdx.length;
        if (nImgs > 0 && remain > 0.5) {
          perImageDur = Math.max(0.8, remain / nImgs); // at least 0.8s per still
        }
      }
    }

    // Build segments
    const segPaths: string[] = [];
    for (let i = 0; i < inputPaths.length; i++) {
      const inputPath = inputPaths[i];
      const ext = path.extname(inputPath).toLowerCase();
      const seg = path.join(jobDir, `seg-${i}.mp4`);

      if (looksLikeImage(inputPath)) {
        await makeImageSegment(inputPath, seg, perImageDur, !!bgBlur, (motion as Motion) || "zoom_in");
      } else {
        await makeVideoSegment(inputPath, seg, !!keepVideoAudio, !!bgBlur, videoTrim);
      }
      segPaths.push(seg);
    }

    const listPath = path.join(jobDir, "concat.txt");
    await writeConcatListAbsolute(segPaths, listPath);

    const outName = `reel-${jobId}.mp4`;
    const outPathDisk = path.join(diskRoot, outName);
    await concatSegments(listPath, outPathDisk);

    let finalDiskPath = outPathDisk;
    if (bgMusicUrl && !keepVideoAudio) {
      let musicAbs = bgMusicUrl;
      if (musicAbs.startsWith("/")) musicAbs = path.join(process.cwd(), "public", musicAbs);
      finalDiskPath = await replaceAudioWithMusic(outPathDisk, musicAbs); // throws if not audio
      try { fs.unlinkSync(outPathDisk); } catch {}
    }

    // ALWAYS ensure file is present in /public/renders for the browser
    const publicCopy = path.join(publicRoot, path.basename(finalDiskPath));
    try { fs.copyFileSync(finalDiskPath, publicCopy); } catch {}

    // Cleanup temp
    try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch {}

    if (!pro) bumpCount(email);

    const relUrl = `/renders/${path.basename(finalDiskPath)}`;
    recordRender(email, relUrl, items.length);

    // DB persist + prune latest 20
    try {
      const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      const anyClient: any = prisma as any;
      if (user && anyClient.render) {
        const stat = fs.statSync(finalDiskPath);
        const fileName = path.basename(finalDiskPath);

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
            const pth = path.join(diskRoot, r.fileName);
            try { fs.unlinkSync(pth); } catch {}
            try { fs.unlinkSync(path.join(publicRoot, r.fileName)); } catch {}
          }
          await anyClient.render.deleteMany({ where: { id: { in: toDelete.map((r: any) => r.id) } } });
        }
      }
    } catch (dbErr) {
      console.error("RENDER_DB_PERSIST_OR_PRUNE_FAIL", dbErr);
    }

    return res.json({
      ok: true,
      url: relUrl,
      usedPerImageSec: perImageDur,
      matchedToMusic: !!(matchMusicDuration && bgMusicUrl),
    });
  } catch (e: any) {
    console.error("RENDER_FAIL", e?.message || e);
    return res.status(500).json({ ok: false, error: "render_failed", details: e?.message || String(e) });
  }
}

// allow large image dataURLs
export const config = { api: { bodyParser: { sizeLimit: "150mb" } } };