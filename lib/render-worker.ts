// lib/render-worker.ts
/**
 * Background render worker
 * - Picks oldest QUEUED job, atomically marks RUNNING, renders, then DONE/FAILED
 * - Normalizes images (HEIC/HDR/etc) to 8-bit sRGB JPEG with sharp
 * - Handles videos, optional bg music, blur background, smooth Ken Burns for stills
 * - Writes outputs to /public/renders (auto-symlink to /data/renders for persistence)
 * - Inserts Render row and prunes to last 20 per user
 *
 * Build:   npm run build:worker   (tsconfig.worker.json -> dist/lib/render-worker.js)
 * Run:     node dist/lib/render-worker.js
 */

import { prisma } from "./prisma";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobeMod from "ffprobe-static";

// Optional: image normalization (HEIC/HDR -> JPEG sRGB)
let sharp: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  sharp = require("sharp");
} catch {
  sharp = null;
}

type Motion = "zoom_in" | "zoom_out" | "pan_left" | "pan_right" | "cover";

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;           // lower if you need even less memory
const PRESET = "veryfast";
const CRF = "23";
const SWS = "bicubic+accurate_rnd+full_chroma_int";

// --------- tiny helpers ----------
const fwd = (p: string) => p.replace(/\\/g, "/");
function ensureDir(p: string) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
function even(n: number) { return Math.max(2, Math.floor(n / 2) * 2); }
function nowTs() { return Date.now(); }

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
  return run(bin, ["-hide_banner", "-loglevel", "error", ...args, "-threads", "1"]);
}
function ffprobeInfo(input: string): Promise<{ w: number; h: number; rot: number; dur?: number }> {
  const ffprobePath = (ffprobeMod as any)?.path || (ffprobeMod as any) || "ffprobe";
  const args = [
    "-v", "error",
    "-show_streams",
    "-select_streams", "v:0",
    "-of", "json",
    input
  ];
  return run(ffprobePath, args).then(json => {
    try {
      const o = JSON.parse(json || "{}");
      const s = (o.streams && o.streams[0]) || {};
      const w = Number(s.width) || WIDTH;
      const h = Number(s.height) || HEIGHT;
      const rot = Number((s.tags && s.tags.rotate) || 0) || 0;
      const dur = s.duration ? Number(s.duration) : undefined;
      return { w, h, rot, dur };
    } catch {
      return { w: WIDTH, h: HEIGHT, rot: 0 };
    }
  });
}

function guessExt(name?: string, mime?: string) {
  if (mime?.startsWith("image/")) return ".jpg";
  if (mime?.startsWith("video/")) {
    if (mime.endsWith("mp4") || (name && name.toLowerCase().endsWith(".mp4"))) return ".mp4";
    if (mime.endsWith("quicktime") || (name && name.toLowerCase().endsWith(".mov"))) return ".mov";
    if (mime.endsWith("webm") || (name && name.toLowerCase().endsWith(".webm"))) return ".webm";
    return ".mp4";
  }
  if (mime?.startsWith("audio/")) return ".m4a";
  if (name) return path.extname(name) || ".bin";
  return ".bin";
}
function decodeDataURL(data?: string): { mime: string; buf?: Buffer } {
  if (!data) return { mime: "" };
  const m = /^data:(.+?);base64,(.+)$/i.exec(data);
  if (!m) return { mime: "", buf: undefined };
  return { mime: m[1], buf: Buffer.from(m[2], "base64") };
}

async function normalizeImage(buf: Buffer): Promise<Buffer> {
  if (!sharp) return buf;
  try {
    return await sharp(buf)
      .rotate()
      .toColorspace("srgb")
      .jpeg({ quality: 82, chromaSubsampling: "4:2:0" })
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .toBuffer();
  } catch {
    return buf;
  }
}

function ensurePersistentRendersDir(): string {
  // Persist on /data if available, serve via /public/renders
  const dataRenders = path.join(process.cwd(), "data", "renders");
  const pubDir = path.join(process.cwd(), "public");
  const pubRenders = path.join(pubDir, "renders");
  ensureDir(dataRenders);
  ensureDir(pubDir);

  // If public/renders is not a symlink -> create/replace with symlink to data/renders
  try {
    const st = fs.lstatSync(pubRenders);
    if (!st.isSymbolicLink()) {
      fs.rmSync(pubRenders, { recursive: true, force: true });
      fs.symlinkSync(dataRenders, pubRenders, "dir");
    }
  } catch {
    try { fs.symlinkSync(dataRenders, pubRenders, "dir"); } catch { ensureDir(pubRenders); }
  }
  return pubRenders; // symlink path used by Next static
}

// ---------- VF builders ----------
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
function buildContainWithBlurVF(kind: "image" | "video", secondsDur: number, motion: Motion, rot: number, srcW: number, srcH: number, useBlur: boolean) {
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
    `fade=t=in:st=0:d=${fin},fade=t=out:st=${(secondsDur - fout).toFixed(2)}:d=${fout},` +
    `fps=${FPS},format=yuv420p`;

  return vf;
}

// ---------- segment writers ----------
async function makeImageSegment(inputPath: string, outPath: string, durSec: number, bgBlur: boolean, motion: Motion) {
  const info = await ffprobeInfo(inputPath);
  const vf = buildContainWithBlurVF("image", durSec, motion, info.rot, info.w, info.h, bgBlur !== false);
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
async function makeVideoSegment(inputPath: string, outPath: string, keepAudio: boolean, bgBlur: boolean, trimToSec?: number) {
  const base = baseFitVideo(bgBlur);
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

// ---------- concat / music ----------
async function writeConcatList(fileList: string[], listPath: string) {
  fs.writeFileSync(listPath, fileList.map(abs => `file '${fwd(path.resolve(abs))}'`).join("\n"), "utf8");
}
async function concatSegments(listPath: string, outPath: string) {
  await runFF(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath]);
}
async function replaceAudioWithMusic(videoPath: string, musicPath: string) {
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

// ---------- worker loop ----------
let booted = false;
if (!(global as any).__renderLoopBooted) {
  (global as any).__renderLoopBooted = true;
  boot();
}

function boot() {
  if (booted) return;
  booted = true;
  // every 3s, pick a job
  setInterval(() => {
    tick().catch((e) => console.error("WORKER_TICK_FAIL", e?.message || e));
  }, 3000);
}

async function tick() {
  // atomically claim one job
  const oldest = await prisma.renderJob.findFirst({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
  });
  if (!oldest) return;

  const claimed = await prisma.renderJob.updateMany({
    where: { id: oldest.id, status: "QUEUED" },
    data: { status: "RUNNING" },
  });
  if (claimed.count === 0) return; // someone else took it

  try {
    const rendersDir = ensurePersistentRendersDir();
    const job = await prisma.renderJob.findUnique({ where: { id: oldest.id } });
    if (!job) throw new Error("job_missing");

    const payload: any = {
      items: job.items,
      options: job.options || {},
    };

    const items: Array<{ name?: string; dataUrl?: string; url?: string; mime?: string }> = Array.isArray(payload.items) ? payload.items : [];
    const opt = payload.options || {};
    const durationSec = Number(opt.durationSec ?? 2.5);
    const maxPerVideoSec = Number(opt.maxPerVideoSec ?? 0);
    const keepVideoAudio = !!opt.keepVideoAudio && !opt.music; // override if music present
    const bgBlur = opt.bgBlur !== false;
    const motion: Motion = ["zoom_in","zoom_out","pan_left","pan_right","cover"].includes(opt.motion) ? opt.motion : "zoom_in";
    const music = opt.music as ( { name?: string; dataUrl?: string } | null );

    // temp dir per job
    const jobId = job.id;
    const tmpDir = path.join(rendersDir, `tmp-${jobId}`);
    ensureDir(tmpDir);

    // if matchMusicDuration, compute target length
    let musicPath: string | null = null;
    let musicSeconds: number | null = null;
    if (music?.dataUrl) {
      const { mime, buf } = decodeDataURL(music.dataUrl);
      if (buf?.length) {
        const ext = guessExt(music.name, mime);
        musicPath = path.join(tmpDir, `music${ext}`);
        fs.writeFileSync(musicPath, buf);
        const info = await ffprobeInfo(musicPath);
        musicSeconds = info.dur ?? null;
      }
    }
    const wantMatch = !!opt.matchMusicDuration && !!musicPath && musicSeconds && musicSeconds > 2;

    // Prepare segments (normalize images first)
    const segs: string[] = [];
    let imageCount = 0;
    let videoCount = 0;

    // If matching, compute per-image duration to fit remaining after videos
    let perImage = durationSec;
    if (wantMatch) {
      // rough pass to estimate video budget
      const vids = items.filter(x => (x.mime||"").startsWith("video/") || (x.url||"").toLowerCase().match(/\.(mp4|mov|webm)$/));
      const budget = vids.length * (maxPerVideoSec > 0 ? maxPerVideoSec : 3);
      const rem = Math.max(1, (musicSeconds as number) - budget);
      const stills = items.length - vids.length;
      perImage = stills > 0 ? Math.max(1.2, Math.min(4.0, rem / stills)) : durationSec;
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      let inputPath: string;
      if (it?.dataUrl) {
        const { mime, buf } = decodeDataURL(it.dataUrl);
        if (!buf?.length) throw new Error("bad_data_url");
        let out = buf;
        if ((mime || "").startsWith("image/")) {
          out = await normalizeImage(buf);
        }
        const ext = guessExt(it.name, mime);
        inputPath = path.join(tmpDir, `in-${i}${ext}`);
        fs.writeFileSync(inputPath, out);
      } else if (it?.url) {
        let src = it.url as string;
        if (src.startsWith("/")) src = path.join(process.cwd(), "public", src);
        const ext = guessExt(it.name, it.mime);
        inputPath = path.join(tmpDir, `in-${i}${ext}`);
        fs.copyFileSync(src, inputPath);
      } else {
        throw new Error("missing_input");
      }

      const seg = path.join(tmpDir, `seg-${i}.mp4`);
      const ext = path.extname(inputPath).toLowerCase();
      if ([".jpg",".jpeg",".png",".webp"].includes(ext)) {
        imageCount++;
        await makeImageSegment(inputPath, seg, perImage, bgBlur, motion);
      } else {
        videoCount++;
        await makeVideoSegment(inputPath, seg, keepVideoAudio, bgBlur, maxPerVideoSec > 0 ? maxPerVideoSec : undefined);
      }
      segs.push(seg);
      // cleanup input after segment is made to save space
      try { fs.unlinkSync(inputPath); } catch {}
    }

    const listPath = path.join(tmpDir, "concat.txt");
    await writeConcatList(segs, listPath);

    const outName = `reel-${nowTs()}-${jobId.slice(0,8)}.mp4`;
    const outPath = path.join(rendersDir, outName);
    await concatSegments(listPath, outPath);

    let finalPath = outPath;
    if (musicPath) {
      finalPath = await replaceAudioWithMusic(outPath, musicPath);
      try { fs.unlinkSync(outPath); } catch {}
    }

    // cleanup temp files
    try {
      for (const s of segs) fs.unlinkSync(s);
      if (musicPath) try { fs.unlinkSync(musicPath); } catch {}
      fs.unlinkSync(listPath);
      fs.rmdirSync(tmpDir);
    } catch {}

    const relUrl = `/renders/${path.basename(finalPath)}`;

    // Save render row & prune
    try {
      const stat = fs.statSync(finalPath);
      await prisma.render.create({
        data: {
          userId: (await ensureUser(job.userEmail)).id,
          fileName: path.basename(finalPath),
          url: relUrl,
          bytes: stat.size,
        },
      });
      await pruneOldRendersForUser(job.userEmail, rendersDir);
    } catch (dbErr) {
      console.error("RENDER_DB_SAVE_FAIL", dbErr);
    }

    await prisma.renderJob.update({
      where: { id: job.id },
      data: { status: "DONE", outputUrl: relUrl, error: null },
    });
  } catch (e: any) {
    console.error("RENDER_JOB_FAIL", e?.message || e);
    try {
      await prisma.renderJob.update({
        where: { id: oldest.id },
        data: { status: "FAILED", error: e?.message || String(e) },
      });
    } catch {}
  }
}

async function ensureUser(email: string) {
  const e = email.toLowerCase();
  const u = await prisma.user.findUnique({ where: { email: e } });
  if (u) return u;
  // shouldn't happen (jobs are created by signed-in users), but be safe
  return prisma.user.create({ data: { email: e } });
}

async function pruneOldRendersForUser(email: string, rendersDir: string) {
  const KEEP = 20;
  const u = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!u) return;
  const toDelete = await prisma.render.findMany({
    where: { userId: u.id },
    orderBy: { createdAt: "desc" },
    skip: KEEP,
    select: { id: true, fileName: true },
  });
  if (!toDelete.length) return;
  for (const r of toDelete) {
    try { fs.unlinkSync(path.join(rendersDir, r.fileName)); } catch {}
  }
  await prisma.render.deleteMany({ where: { id: { in: toDelete.map(r => r.id) } } });
}