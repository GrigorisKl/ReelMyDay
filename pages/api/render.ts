// pages/api/render.ts
import type { NextApiRequest, NextApiResponse } from "next";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobeMod from "ffprobe-static";
import sharp from "sharp";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import { prisma } from "../../lib/prisma";

/** ---------- Constants ---------- */
const OWNER_EMAIL = "grigoriskleanthous@gmail.com";
const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const PRESET = "veryfast";
const CRF = "23";
const SWS = "bicubic+accurate_rnd+full_chroma_int"; // good scaler

/** ---------- Helpers ---------- */
const binFFMPEG = (ffmpegPath as string) || process.env.FFMPEG_PATH || "ffmpeg";
const binFFPROBE = (ffprobeMod as any)?.path || (ffprobeMod as any) || "ffprobe";
const fwd = (p: string) => p.replace(/\\/g, "/");
function ensureDir(p: string) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
function nowTs() { return Date.now(); }
function even(n: number) { return Math.max(2, Math.floor(n / 2) * 2); }
function seconds(n?: any, def = 3) { const v = Number(n); return Number.isFinite(v) && v > 0 ? v : def; }

function run(bin: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd, windowsHide: true });
    let out = ""; let err = "";
    p.stdout.on("data", d => (out += d.toString()));
    p.stderr.on("data", d => (err += d.toString()));
    p.on("close", (code) => (code === 0 ? resolve(out || err) : reject(new Error(`${bin} exited ${code}\n${err}`))));
  });
}
const runFF = (args: string[]) => run(binFFMPEG, args);

async function probeJson(input: string): Promise<any> {
  const args = [
    "-v", "error",
    "-print_format", "json",
    "-show_streams",
    "-show_format",
    input,
  ];
  const txt = await run(binFFPROBE, args);
  try { return JSON.parse(txt); } catch { return {}; }
}

function isLikelyHDR(meta: any): boolean {
  const v = (meta?.streams || []).find((s: any) => s.codec_type === "video") || {};
  const prim = String(v.color_primaries || v.tags?.color_primaries || "").toLowerCase();
  const trn  = String(v.color_transfer || v.tags?.color_transfer || "").toLowerCase();
  const spc  = String(v.color_space || v.tags?.color_space || "").toLowerCase();
  const pix  = String(v.pix_fmt || "").toLowerCase();
  // bt2020 + smpte2084 (PQ) or HLG and 10-bit pixel formats are good signals
  return /2020/.test(prim + spc) || /2084|hlg|arib-std-b67/.test(trn) || /p10|yuv420p10|yuv422p10/.test(pix);
}

function ensureRendersDir() {
  const pub = path.join(process.cwd(), "public");
  ensureDir(pub);
  const renders = path.join(pub, "renders");
  ensureDir(renders);
  return renders;
}

function isPro(email: string, proList: Set<string>) {
  const e = (email || "").toLowerCase();
  return !!e && (e === OWNER_EMAIL || proList.has(e));
}

function envProEmails(): Set<string> {
  const s = (process.env.PRO_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set(s);
}

/** ---------- File intake ---------- */
function guessExt(name?: string, mime?: string) {
  if (mime?.startsWith("image/")) {
    if (/heic|heif/i.test(mime) || /\.heic$|\.heif$/i.test(name || "")) return ".heic";
    if (/png/i.test(mime)) return ".png";
    if (/jpeg|jpg/i.test(mime)) return ".jpg";
    if (/webp/i.test(mime)) return ".webp";
    return ".png";
  }
  if (mime?.startsWith("video/")) {
    if (/mp4/i.test(mime)) return ".mp4";
    if (/quicktime/i.test(mime)) return ".mov";
    if (/webm/i.test(mime)) return ".webm";
    return ".mp4";
  }
  if (mime?.startsWith("audio/")) return ".mp3";
  const ext = path.extname(name || "");
  return ext || ".bin";
}

function decodeDataURL(data?: string): { mime: string; buf?: Buffer } {
  if (!data) return { mime: "" };
  const m = /^data:(.+?);base64,(.+)$/i.exec(data);
  if (!m) return { mime: "", buf: undefined };
  return { mime: m[1], buf: Buffer.from(m[2], "base64") };
}

/** Save any incoming item (image/video/audio) to tmp folder */
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
    // server-side path (only if you pass server-relative URLs)
    let src = item.url as string;
    if (src.startsWith("/")) src = path.join(process.cwd(), "public", src);
    const ext = guessExt(item.name, item.mime);
    const out = path.join(tmpDir, `in-${i}${ext}`);
    fs.copyFileSync(src, out);
    return out;
  }
  throw new Error("missing_input");
}

/** Convert HEIC/HDR stills to an SDR PNG that ffmpeg loves */
async function normalizeStill(inputPath: string, outPng: string) {
  const buf = await sharp(inputPath).withMetadata().png({ quality: 95 }).toBuffer();
  fs.writeFileSync(outPng, buf);
}

/** ---------- Math / layout ---------- */
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

/** Build smooth Ken-Burns inside a constant box */
function buildContainWithBlurVF(
  kind: "image" | "video",
  secondsDur: number,
  motion: "zoom_in" | "zoom_out" | "pan_left" | "pan_right" | "cover",
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

  return (
    `${rotVF}setsar=1,split=2[bg][fg];` +
    `[bg]${bgBase},setsar=1[bg];` +
    `[fg]scale=${fw}:${fh},setsar=1[fg0];` +
    `${fgAnim};` +
    `[bg][fgi]overlay=x='(W-w)/2':y='(H-h)/2',` +
    `fade=t=in:st=0:d=${fin},fade=t=out:st=${(secondsDur - fout).toFixed(2)}:d=${fout},` +
    `fps=${FPS},format=yuv420p`
  );
}

/** ---------- Segment writers ---------- */
async function makeImageSegment(inputPath: string, outPath: string, durSec: number, bgBlur: boolean, motion: any) {
  // Normalize HEIC/HDR stills -> PNG (SDR)
  const ext = path.extname(inputPath).toLowerCase();
  let still = inputPath;
  if (ext === ".heic" || ext === ".heif") {
    still = inputPath.replace(ext, ".png");
    await normalizeStill(inputPath, still);
  }

  // Probe (size + rotation)
  const meta = await probeJson(still);
  const v = (meta.streams || [])[0] || {};
  const rot = Number(v.tags?.rotate || v.side_data_list?.[0]?.rotation || 0) || 0;
  const w = Number(v.width || 2000);
  const h = Number(v.height || 2000);

  const vf = buildContainWithBlurVF("image", durSec, motion, rot, w, h, bgBlur !== false);
  const args = [
    "-y",
    "-loop", "1",
    "-framerate", String(FPS),
    "-t", String(durSec),
    "-i", still,
    "-f", "lavfi", "-t", String(durSec), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-filter_complex", vf + "[v]",
    "-map", "[v]",
    "-map", "1:a",
    "-c:v", "libx264",
    "-preset", PRESET,
    "-crf", CRF,
    "-pix_fmt", "yuv420p",
    "-r", String(FPS),
    "-c:a", "aac", "-b:a", "160k",
    "-movflags", "+faststart",
    "-threads", "1",
    "-shortest",
    outPath,
  ];
  await runFF(args);
}

function baseFitVideo(bgBlur: boolean, toneMap: boolean): string {
  const cover = bgBlur
    ? `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:flags=${SWS},crop=${WIDTH}:${HEIGHT},gblur=sigma=36`
    : `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:flags=${SWS},crop=${WIDTH}:${HEIGHT}`;

  // tone-map HDR to SDR (bt709) if needed
  const tone = toneMap
    ? ",zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,format=yuv420p"
    : "";

  return [
    // foreground (fit inside 1080x1920)
    `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease:flags=${SWS}${tone}[fit]`,
    // background
    `[0:v]${cover}[bg]`,
    // compose
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
  const meta = await probeJson(inputPath);
  const toneMap = isLikelyHDR(meta);
  const vf = baseFitVideo(bgBlur, toneMap) + `,fps=${FPS},format=yuv420p,setsar=1`;

  const args: string[] = ["-y"];
  if (trimToSec && trimToSec > 0) args.push("-t", String(trimToSec));
  args.push("-i", inputPath);

  if (keepAudio) {
    args.push(
      "-filter_complex", vf + "[v]",
      "-map", "[v]",
      "-map", "0:a?",
      "-c:v", "libx264",
      "-preset", PRESET,
      "-crf", CRF,
      "-pix_fmt", "yuv420p",
      "-r", String(FPS),
      "-c:a", "aac", "-ac", "2", "-ar", "44100", "-b:a", "160k",
      "-movflags", "+faststart",
      "-threads", "1",
      "-shortest",
      outPath
    );
  } else {
    args.push(
      "-f", "lavfi", "-t", trimToSec ? String(trimToSec) : "9999", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-filter_complex", vf + "[v]",
      "-map", "[v]",
      "-map", "1:a",
      "-c:v", "libx264",
      "-preset", PRESET,
      "-crf", CRF,
      "-pix_fmt", "yuv420p",
      "-r", String(FPS),
      "-c:a", "aac", "-ac", "2", "-ar", "44100", "-b:a", "160k",
      "-movflags", "+faststart",
      "-threads", "1",
      "-shortest",
      outPath
    );
  }
  await runFF(args);
}

/** concat list writer */
async function writeConcatListAbsolute(fileList: string[], listPath: string) {
  const lines = fileList.map((abs) => `file '${fwd(path.resolve(abs))}'`).join("\n");
  fs.writeFileSync(listPath, lines, "utf8");
}
async function concatSegments(listPath: string, outPath: string) {
  await runFF(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", outPath]);
}
async function replaceAudioWithMusic(videoPath: string, musicPath: string): Promise<string> {
  const mixedPath = videoPath.replace(/\.mp4$/i, "-music.mp4");
  await runFF([
    "-y",
    "-stream_loop", "-1", "-i", musicPath,
    "-i", videoPath,
    "-map", "1:v:0",
    "-map", "0:a:0",
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    "-shortest",
    mixedPath,
  ]);
  return mixedPath;
}

/** ---------- File-based usage cap (kept) ---------- */
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
  const list = readJSON<any[]>(RENDERS_FILE, []);
  list.push({ email: email.toLowerCase(), url, itemsCount, createdAt: new Date().toISOString() });
  writeJSON(RENDITION_FILE, list);
}
// fix: correct path variable name
const RENDITION_FILE = RENDERS_FILE;

/** ---------- API ---------- */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const session = (await getServerSession(req, res, authOptions as any)) as Session | null;
  const email = session?.user?.email || null;
  if (!email) return res.status(401).json({ ok: false, message: "Please sign in to export." });

  const pro = isPro(email, envProEmails());
  if (!pro) {
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
      music,                      // NEW: { name, dataUrl } or undefined
      matchMusicDuration = false, // NEW: clamp reel ≤ music length
    } = (req.body || {}) as {
      items: Array<{ name?: string; mime?: string; dataUrl?: string; url?: string }>;
      durationSec?: number; maxPerVideoSec?: number;
      keepVideoAudio?: boolean; bgBlur?: boolean; motion?: any;
      music?: { name?: string; dataUrl?: string };
      matchMusicDuration?: boolean;
    };

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: "no_items" });
    }

    // workspace
    const rendersDir = ensureRendersDir();
    const jobId = String(nowTs());
    const jobDir = path.join(rendersDir, `tmp-${jobId}`);
    ensureDir(jobDir);

    // optional music file
    let musicPath = "";
    let musicDur = 0;
    if (music?.dataUrl) {
      const { mime, buf } = decodeDataURL(music.dataUrl);
      if (buf?.length) {
        const ext = guessExt(music.name, mime);
        musicPath = path.join(jobDir, `music${ext || ".mp3"}`);
        fs.writeFileSync(musicPath, buf);
        const mj = await probeJson(musicPath);
        musicDur = Number(mj?.format?.duration || 0);
      }
    }

    const segPaths: string[] = [];
    let usedTotal = 0;
    const targetTotal = matchMusicDuration && musicDur > 0 ? musicDur : 0;

    // build each segment
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const inputPath = saveIncomingItem(jobDir, it, i);
      const ext = path.extname(inputPath).toLowerCase();
      const seg = path.join(jobDir, `seg-${i}.mp4`);

      // if we must keep within music length, compute leftover
      let left = targetTotal ? Math.max(0, targetTotal - usedTotal) : 0;
      const capVideo = seconds(maxPerVideoSec, 0) || 0;

      if ([".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif"].includes(ext)) {
        let dur = seconds(durationSec, 2.5);
        if (targetTotal) dur = Math.min(dur, left || dur);
        if (targetTotal && dur <= 0.01) break;

        await makeImageSegment(inputPath, seg, dur, !!bgBlur, motion);
        segPaths.push(seg);
        usedTotal += dur;
      } else {
        // video
        let trim = capVideo;
        if (targetTotal && left > 0) {
          trim = capVideo ? Math.min(capVideo, left) : left; // respect cap if set
        }
        await makeVideoSegment(inputPath, seg, !!keepVideoAudio, !!bgBlur, trim || undefined);
        // figure out the produced segment duration (probe)
        const pj = await probeJson(seg);
        const dur = Number(pj?.format?.duration || 0);
        if (dur > 0) usedTotal += dur;
        segPaths.push(seg);

        if (targetTotal && usedTotal >= targetTotal - 0.05) break;
      }
    }

    if (segPaths.length === 0) {
      throw new Error("no_segments_written");
    }

    // concat
    const listPath = path.join(jobDir, "concat.txt");
    await writeConcatListAbsolute(segPaths, listPath);

    const outName = `reel-${jobId}.mp4`;
    const outPath = path.join(rendersDir, outName);
    await concatSegments(listPath, outPath);

    // Optionally mix in music (when user provided music and keepVideoAudio = false)
    let finalPath = outPath;
    if (musicPath && !keepVideoAudio) {
      finalPath = await replaceAudioWithMusic(outPath, musicPath);
      try { fs.unlinkSync(outPath); } catch {}
    }

    // cleanup tmp
    try {
      for (const f of segPaths) fs.unlinkSync(f);
      if (musicPath) fs.unlinkSync(musicPath);
      fs.unlinkSync(listPath);
      fs.rmdirSync(jobDir);
    } catch {}

    const relUrl = `/renders/${path.basename(finalPath)}`;
    recordRender(email, relUrl, items.length);
    if (!pro) bumpCount(email);

    // Persist to DB + prune 20 (if Render model exists)
    try {
      const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      const anyClient: any = prisma as any;
      if (user && anyClient.render) {
        const stat = fs.statSync(finalPath);
        const fileName = path.basename(finalPath);
        await anyClient.render.create({ data: { userId: user.id, fileName, url: relUrl, bytes: stat.size } });

        const KEEP = 20;
        const toDelete = await anyClient.render.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          skip: KEEP,
          select: { id: true, fileName: true },
        });
        if (toDelete.length) {
          for (const r of toDelete) { try { fs.unlinkSync(path.join(rendersDir, r.fileName)); } catch {} }
          await anyClient.render.deleteMany({ where: { id: { in: toDelete.map((r: any) => r.id) } } });
        }
      }
    } catch (e) {
      console.warn("DB persist/prune skipped:", e);
    }

    // Always a real mp4 path (no .htm)
    return res.json({ ok: true, url: relUrl });
  } catch (e: any) {
    console.error("RENDER_FAIL", e?.message || e);
    return res.status(500).json({ ok: false, error: "render_failed", details: e?.message || String(e) });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "150mb" } } };