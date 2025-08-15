// pages/api/render.ts
// Mobile-hardened reel renderer (vertical 1080x1920)
// - Normalizes HEIC/HDR → sRGB JPG with sharp
// - Normalizes videos → H264/yuv420p, ≤1280px width
// - Memory-safe ffmpeg flags, sequential steps, atomic file writes
// - One-free export gating unless isPro
// - Persists render list file for /renders page

import type { NextApiRequest, NextApiResponse } from "next";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import sharp from "sharp";
import ffmpegPath from "ffmpeg-static";
import ffprobeMod from "ffprobe-static";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import { prisma } from "../../lib/prisma";

// ---------- Owner / Pro ----------
const OWNER_EMAIL = "grigoriskleanthous@gmail.com";
const WIDTH = 1080, HEIGHT = 1920, FPS = 30;
const PRESET = "veryfast", CRF = "23";
const SWS = "bicubic+accurate_rnd+full_chroma_int";
const TMP_ROOT = path.join(process.cwd(), "data", "tmp");
const PUBLIC_RENDERS = path.join(process.cwd(), "public", "renders");

function ensureDir(p: string) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
ensureDir(TMP_ROOT); ensureDir(PUBLIC_RENDERS);

function isOwnerOrEnvPro(email?: string) {
  if (!email) return false;
  const e = email.toLowerCase();
  if (e === OWNER_EMAIL.toLowerCase()) return true;
  const set = new Set((process.env.PRO_EMAILS || "")
    .split(",").map(s=>s.trim().toLowerCase()).filter(Boolean));
  return set.has(e);
}

async function isPro(email?: string) {
  if (!email) return false;
  if (isOwnerOrEnvPro(email)) return true;
  const u = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { isPro: true } });
  return !!u?.isPro;
}

function run(bin: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd, windowsHide: true });
    let out = "", err = "";
    p.stdout.on("data", d => out += d.toString());
    p.stderr.on("data", d => err += d.toString());
    p.on("close", code => code === 0 ? resolve(out || err) : reject(new Error(err || `${bin} exited ${code}`)));
  });
}
function ff(args: string[]) {
  const bin = (ffmpegPath as string) || "ffmpeg";
  // keep ffmpeg quiet and deterministic with memory
  return run(bin, ["-hide_banner", "-loglevel", "error", ...args]);
}
function probe(input: string): Promise<{ duration: number, width: number, height: number, rotation: number }> {
  const bin = (ffprobeMod as any)?.path || "ffprobe";
  const args = [
    "-v","error","-select_streams","v:0",
    "-show_entries","stream=width,height:stream_tags=rotate",
    "-show_entries","format=duration",
    "-of","json", input
  ];
  return run(bin, args).then(j => {
    try {
      const o = JSON.parse(j || "{}");
      const s = (o.streams && o.streams[0]) || {};
      const f = o.format || {};
      return {
        duration: Number(f.duration) || 0,
        width: Number(s.width) || WIDTH,
        height: Number(s.height) || HEIGHT,
        rotation: Number((s.tags && s.tags.rotate) || 0) || 0,
      };
    } catch { return { duration: 0, width: WIDTH, height: HEIGHT, rotation: 0 }; }
  });
}

// ---------- Limits to stop OOM ----------
const MAX_ITEMS = 80;
const MAX_IMAGE_MB = 16;           // hard cap per image
const MAX_VIDEO_MB = 150;          // hard cap per video
const MAX_TOTAL_MB = 400;          // hard cap per job
const BAD_TYPE = /(^video\/(mp4|quicktime|webm)$)|(^image\/(jpeg|png|webp|heic|heif)$)|(^audio\/(mpeg|mp4|aac|wav|x-wav))|(^application\/octet-stream$)/i;

// ---------- Helpers ----------
function fromDataUrl(s: string){ const m = /^data:(.+?);base64,(.+)$/i.exec(s||""); return m?{mime:m[1],buf:Buffer.from(m[2],"base64")}:null; }
function even(n:number){ return Math.max(2, Math.floor(n/2)*2); }
function fitContain(w:number,h:number){
  const ar = w/h, target = WIDTH/HEIGHT;
  if (ar>=target){ const fh = even(Math.round(WIDTH/ar)); return {fw:WIDTH, fh}; }
  const fw = even(Math.round(HEIGHT*ar)); return {fw, fh:HEIGHT};
}

// ---------- Normalizers ----------
async function normalizeImage(buf: Buffer, outFile: string){
  // convert any HDR/HEIC → sRGB 8-bit JPEG; clamp size (longest 1800)
  const s = sharp(buf, { failOn:"none" });
  const meta = await s.metadata();
  const longest = Math.max(meta.width||0, meta.height||0);
  const limit = Math.max(WIDTH, HEIGHT); // 1920
  const resized = longest>limit ? s.resize({ width: meta.width!>=meta.height! ? limit : undefined, height: meta.height!>meta.width! ? limit : undefined, fit:"inside" }) : s;

  await resized
    .withMetadata({ icc: "sRGB" })
    .jpeg({ quality: 88, chromaSubsampling: "4:2:0" })
    .toFile(outFile);
  return outFile;
}

async function normalizeVideo(inFile: string, outFile: string){
  // Re-encode to H.264, yuv420p, width ≤ 1280 (keeps RAM down),
  // and fix exotic pixel formats from iPhone (HEVC/HDR)
  const vf = `scale='min(1280,iw)':-2:flags=${SWS},format=yuv420p`;
  await ff([
    "-y", "-i", inFile,
    "-vf", vf,
    "-r", String(FPS),
    "-pix_fmt","yuv420p",
    "-c:v","libx264","-profile:v","high","-preset",PRESET,"-crf",CRF,
    "-c:a","aac","-b:a","128k","-ac","2","-ar","44100",
    "-movflags","+faststart",
    "-max_muxing_queue_size","1024",
    outFile
  ]);
  return outFile;
}

// ---------- Build per-clip filter graph (smooth box) ----------
function buildImageVF(secondsDur:number, motion:"zoom_in"|"zoom_out"|"pan_left"|"pan_right"|"cover", rot:number, srcW:number, srcH:number, useBlur:boolean){
  const rotated = rot===90||rot===270;
  const rw = rotated?srcH:srcW,  rh = rotated?srcW:srcH;
  const {fw,fh} = fitContain(rw,rh);
  const frames = Math.max(2, Math.round(secondsDur*FPS)), maxIdx = frames-1;
  const DZ = 0.20, zin=`1.00 + ${DZ}*(n/${maxIdx})`, zout=`1.20 - ${DZ}*(n/${maxIdx})`, zpan="1.08";
  const rotVF = rot===90?"transpose=1,":rot===180?"transpose=1,transpose=1,":rot===270?"transpose=2,":"";
  let fgAnim="";
  if (motion==="zoom_in")   fgAnim = `[fg0]scale=w='iw*(${zin})':h='ih*(${zin})':eval=frame,crop=${fw}:${fh}:x='(iw-ow)/2':y='(ih-oh)/2'[fgi]`;
  else if(motion==="zoom_out") fgAnim = `[fg0]scale=w='iw*(${zout})':h='ih*(${zout})':eval=frame,crop=${fw}:${fh}:x='(iw-ow)/2':y='(ih-oh)/2'[fgi]`;
  else if(motion==="pan_left") fgAnim = `[fg0]scale=w='iw*(${zpan})':h='ih*(${zpan})':eval=frame,crop=${fw}:${fh}:x='(iw-ow)/2 - (iw-ow)/2*(n/${maxIdx})':y='(ih-oh)/2'[fgi]`;
  else if(motion==="pan_right")fgAnim = `[fg0]scale=w='iw*(${zpan})':h='ih*(${zpan})':eval=frame,crop=${fw}:${fh}:x='(iw-ow)/2 + (iw-ow)/2*(n/${maxIdx})':y='(ih-oh)/2'[fgi]`;
  else                         fgAnim = `[fg0]copy[fgi]`;

  const fin=0.25, fout=Math.max(0.25, Math.min(0.6, secondsDur*0.15));
  const bg = useBlur
    ? `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:flags=${SWS},crop=${WIDTH}:${HEIGHT},gblur=sigma=24`
    : `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:flags=${SWS},crop=${WIDTH}:${HEIGHT}`;

  return `${rotVF}setsar=1,split=2[bg][fg];[bg]${bg},setsar=1[bg];[fg]scale=${fw}:${fh},setsar=1[fg0];${fgAnim};[bg][fgi]overlay=(W-w)/2:(H-h)/2,fade=t=in:st=0:d=${fin},fade=t=out:st=${(secondsDur-fout).toFixed(2)}:d=${fout},fps=${FPS},format=yuv420p`;
}

async function makeImageSegment(inFile:string, outFile:string, dur:number, bgBlur:boolean, motion:any){
  const info = await probe(inFile);
  const vf = buildImageVF(dur, motion, info.rotation, info.width, info.height, !!bgBlur);
  await ff([
    "-y",
    "-loop","1","-framerate",String(FPS),"-t",String(dur),"-i",inFile,
    "-f","lavfi","-t",String(dur),"-i","anullsrc=channel_layout=stereo:sample_rate=44100",
    "-filter_complex", `${vf}[v]`,
    "-map","[v]","-map","1:a",
    "-c:v","libx264","-preset",PRESET,"-crf",CRF,"-pix_fmt","yuv420p","-r",String(FPS),
    "-c:a","aac","-b:a","160k",
    "-shortest",
    outFile
  ]);
}

function baseFitVideo(bgBlur:boolean){
  if (!bgBlur) return `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease:flags=${SWS},pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2`;
  return [
    `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease:flags=${SWS}[fit]`,
    `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:flags=${SWS},crop=${WIDTH}:${HEIGHT},gblur=sigma=24[bg]`,
    `[bg][fit]overlay=(W-w)/2:(H-h)/2`
  ].join(";");
}
async function makeVideoSegment(inFile:string, outFile:string, keepAudio:boolean, bgBlur:boolean, trimTo?:number){
  const vf = `${baseFitVideo(bgBlur)},fps=${FPS},format=yuv420p,setsar=1`;
  const args:string[] = ["-y"];
  if (trimTo && trimTo>0) args.push("-t", String(trimTo));
  args.push("-i", inFile);

  if (keepAudio){
    args.push(
      "-filter_complex", `[0:v]${vf}[v]`,
      "-map","[v]","-map","0:a?",
      "-c:v","libx264","-preset",PRESET,"-crf",CRF,"-pix_fmt","yuv420p","-r",String(FPS),
      "-c:a","aac","-ac","2","-ar","44100","-b:a","160k",
      "-shortest",
      "-max_muxing_queue_size","1024",
      outFile
    );
  } else {
    args.push(
      "-f","lavfi","-t", trimTo ? String(trimTo) : "9999", "-i","anullsrc=channel_layout=stereo:sample_rate=44100",
      "-filter_complex", `[0:v]${vf}[v]`,
      "-map","[v]","-map","1:a",
      "-c:v","libx264","-preset",PRESET,"-crf",CRF,"-pix_fmt","yuv420p","-r",String(FPS),
      "-c:a","aac","-ac","2","-ar","44100","-b:a","160k",
      "-shortest",
      "-max_muxing_queue_size","1024",
      outFile
    );
  }
  await ff(args);
}

async function concatSegments(listPath:string, outFile:string){
  await ff(["-y","-f","concat","-safe","0","-i",listPath,"-c","copy","-movflags","+faststart",outFile]);
}

async function replaceAudio(videoFile:string, musicFile:string){
  const info = await probe(videoFile);
  // loop by –stream_loop only to the final duration; this is OK and cheap
  const out = videoFile.replace(/\.mp4$/i, "-music.mp4");
  await ff([
    "-y",
    "-stream_loop","-1","-t", String(Math.ceil(info.duration||0) || 600), "-i", musicFile,
    "-i", videoFile,
    "-map","1:v:0","-map","0:a:0",
    "-c:v","copy","-c:a","aac","-b:a","192k",
    "-shortest",
    out
  ]);
  return out;
}

// ---------- Legacy usage for /renders page ----------
const DATA_DIR = path.join(process.cwd(), "data");
const USAGE_FILE = path.join(DATA_DIR, "usage.json");
const RENDERS_FILE = path.join(DATA_DIR, "renders.json");
function readJSON<T=any>(file:string, fallback:T):T{ try{ensureDir(DATA_DIR); if(!fs.existsSync(file)) return fallback; return JSON.parse(fs.readFileSync(file,"utf8")||"null")??fallback;}catch{return fallback;}}
function writeJSON(file:string, data:any){ try{ensureDir(DATA_DIR); fs.writeFileSync(file, JSON.stringify(data,null,2),"utf8");}catch{}}
function getCount(email:string){ const m=readJSON<Record<string,number>>(USAGE_FILE,{}); return m[email.toLowerCase()]||0; }
function bumpCount(email:string){ const m=readJSON<Record<string,number>>(USAGE_FILE,{}); const k=email.toLowerCase(); m[k]=(m[k]||0)+1; writeJSON(USAGE_FILE,m); }
function recordRender(email:string,url:string,itemsCount:number){ const list=readJSON<any[]>(RENDERS_FILE,[]); list.push({email:email.toLowerCase(),url,itemsCount,createdAt:new Date().toISOString()}); writeJSON(RENTERS_FILE,list); }
const RENTERS_FILE = RENDERS_FILE; // typo guard for old code using constant

// ---------- API ----------
export const config = { api: { bodyParser: { sizeLimit: "200mb" } } };

export default async function handler(req:NextApiRequest,res:NextApiResponse){
  if (req.method!=="POST") return res.status(405).end();

  const session = await getServerSession(req,res,authOptions as any) as Session|null;
  const email = session?.user?.email || null;
  if (!email) return res.status(401).json({ ok:false, message:"Please sign in to export." });

  // Gate: first export free unless Pro
  const pro = await isPro(email);
  if (!pro && getCount(email) >= 1){
    return res.status(402).json({ ok:false, message:"Free limit reached. Please subscribe to continue." });
  }

  try{
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
      keepVideoAudio?: boolean; bgBlur?: boolean; motion?: any;
      bgMusicUrl?: string;
    };

    if (!Array.isArray(items) || !items.length) return res.status(400).json({ ok:false, error:"no_items" });
    if (items.length > MAX_ITEMS) return res.status(413).json({ ok:false, error:"too_many_items", message:`Too many files (${items.length}). Limit is ${MAX_ITEMS}.` });

    // Size/Type pre-checks
    let total = 0;
    for (const it of items){
      if (!it?.dataUrl && !it?.url) return res.status(400).json({ ok:false, error:"bad_item" });
      if (it?.dataUrl){
        const d = fromDataUrl(it.dataUrl); if (!d) return res.status(400).json({ ok:false, error:"bad_dataurl" });
        if (!BAD_TYPE.test(d.mime)) return res.status(415).json({ ok:false, error:"bad_type", message:d.mime });
        total += d.buf.byteLength;
        const mb = d.buf.byteLength / (1024*1024);
        if (d.mime.startsWith("image/") && mb > MAX_IMAGE_MB) return res.status(413).json({ ok:false, error:"image_too_big", message:`${Math.round(mb)}MB > ${MAX_IMAGE_MB}MB` });
        if (d.mime.startsWith("video/") && mb > MAX_VIDEO_MB) return res.status(413).json({ ok:false, error:"video_too_big", message:`${Math.round(mb)}MB > ${MAX_VIDEO_MB}MB` });
      }
    }
    if (total/(1024*1024) > MAX_TOTAL_MB) return res.status(413).json({ ok:false, error:"job_too_big", message:`Total upload too large. Limit ~${MAX_TOTAL_MB}MB.` });

    const jobId = String(Date.now());
    const jobDir = path.join(TMP_ROOT, `job-${jobId}`);
    ensureDir(jobDir);

    // Normalize each item to safe intermediates inside jobDir
    const segs:string[] = [];
    for (let i=0;i<items.length;i++){
      const it = items[i];
      let srcAbs = "";

      if (it.dataUrl){
        const dec = fromDataUrl(it.dataUrl)!;
        if (dec.mime.startsWith("image/")){
          const tmp = path.join(jobDir, `img-${i}.jpg`);
          await normalizeImage(dec.buf, tmp);
          // turn each image into a short video segment
          const seg = path.join(jobDir, `seg-${i}.mp4`);
          await makeImageSegment(tmp, seg, Number(durationSec)||2.5, !!bgBlur, motion || "zoom_in");
          segs.push(seg);
          continue;
        } else if (dec.mime.startsWith("video/")){
          const raw = path.join(jobDir, `rawv-${i}.mp4`);
          fs.writeFileSync(raw, dec.buf);
          const norm = path.join(jobDir, `vid-${i}.mp4`);
          await normalizeVideo(raw, norm);
          const seg = path.join(jobDir, `seg-${i}.mp4`);
          await makeVideoSegment(norm, seg, !!keepVideoAudio, !!bgBlur, Number(maxPerVideoSec)||0);
          segs.push(seg);
          continue;
        } else {
          return res.status(415).json({ ok:false, error:"bad_type" });
        }
      } else if (it.url){
        // local file in /public
        srcAbs = it.url.startsWith("/")
          ? path.join(process.cwd(),"public", it.url)
          : it.url;
        const ext = path.extname(srcAbs).toLowerCase();
        if ([".png",".jpg",".jpeg",".webp",".heic",".heif"].includes(ext)){
          const buf = fs.readFileSync(srcAbs);
          const tmp = path.join(jobDir, `img-${i}.jpg`);
          await normalizeImage(buf, tmp);
          const seg = path.join(jobDir, `seg-${i}.mp4`);
          await makeImageSegment(tmp, seg, Number(durationSec)||2.5, !!bgBlur, motion || "zoom_in");
          segs.push(seg);
        } else {
          const norm = path.join(jobDir, `vid-${i}.mp4`);
          await normalizeVideo(srcAbs, norm);
          const seg = path.join(jobDir, `seg-${i}.mp4`);
          await makeVideoSegment(norm, seg, !!keepVideoAudio, !!bgBlur, Number(maxPerVideoSec)||0);
          segs.push(seg);
        }
      }
    }

    // Concat
    const list = path.join(jobDir,"concat.txt");
    fs.writeFileSync(list, segs.map(s=>`file '${s.replace(/\\/g,"/")}'`).join("\n"),"utf8");
    const targetName = `reel-${jobId}.mp4`;
    const tmpOut = path.join(jobDir, targetName);
    await concatSegments(list, tmpOut);

    // Optional music (audio-only)
    let finalAbs = tmpOut;
    if (bgMusicUrl){
      // only allow audio types here (no videos as music to keep CPU lower)
      let musicAbs = bgMusicUrl.startsWith("/")
        ? path.join(process.cwd(),"public", bgMusicUrl)
        : "";
      // If user uploaded as dataUrl (frontend), send it as item with dataUrl under a different key;
      // otherwise, just require a static URL in /public for now.
      if (fs.existsSync(musicAbs)) {
        finalAbs = await replaceAudio(tmpOut, musicAbs);
        try{ fs.unlinkSync(tmpOut); }catch{}
      }
    }

    // Atomic publish: move into public/renders
    const finalName = path.basename(finalAbs);
    const publishTo = path.join(PUBLIC_RENDERS, finalName);
    fs.renameSync(finalAbs, publishTo);

    // Clean job dir
    try { for (const f of fs.readdirSync(jobDir)) fs.unlinkSync(path.join(jobDir,f)); fs.rmdirSync(jobDir); } catch {}

    if (!pro) bumpCount(email);

    const relUrl = `/renders/${finalName}`;
    recordRender(email, relUrl, items.length);

    return res.json({ ok:true, url: relUrl });
  } catch (err:any){
    console.error("RENDER_FAIL", err?.message || err);
    // Try not to leave temp dirs around on error
    return res.status(500).json({ ok:false, error:"render_failed", message: err?.message || "ffmpeg failed" });
  }
}