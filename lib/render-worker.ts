// lib/renderWorker.ts
import { prisma } from "./prisma";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const PRESET = "veryfast";
const CRF = "23";
const SWS = "bicubic+accurate_rnd+full_chroma_int";

function ensureDir(p: string) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
const fwd = (p: string) => p.replace(/\\/g, "/");
function rendersDir() {
  const p = path.join(process.cwd(), "public", "renders");
  ensureDir(path.join(process.cwd(), "public"));
  ensureDir(p);
  return p;
}

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
  return run(bin, ["-hide_banner", "-loglevel", "error", ...args, "-threads", "1"]);
}
function probeVideo(input: string): Promise<{ w:number; h:number; rot:number }> {
  const bin = (ffprobeStatic as any)?.path || "ffprobe";
  return run(bin, [
    "-v","error","-select_streams","v:0",
    "-show_entries","stream=width,height:stream_tags=rotate",
    "-of","json", input
  ]).then(json => {
    try {
      const o = JSON.parse(json || "{}");
      const s = (o.streams && o.streams[0]) || {};
      const r = Number((s.tags && s.tags.rotate) || 0) || 0;
      return { w: Number(s.width)||WIDTH, h: Number(s.height)||HEIGHT, rot: r };
    } catch { return { w: WIDTH, h: HEIGHT, rot: 0 }; }
  });
}
function decodeDataURL(data?: string): { mime: string; buf?: Buffer } {
  if (!data) return { mime: "" };
  const m = /^data:(.+?);base64,(.+)$/i.exec(data);
  if (!m) return { mime: "", buf: undefined };
  return { mime: m[1], buf: Buffer.from(m[2], "base64") };
}
function guessExt(name?: string, mime?: string) {
  if (mime?.startsWith("image/")) return ".png";
  if (mime?.startsWith("video/")) return ".mp4";
  if (mime?.startsWith("audio/")) return ".m4a";
  if (name) return path.extname(name) || ".bin";
  return ".bin";
}
async function writeIncoming(tmpDir: string, it: any, i: number) {
  if (it?.dataUrl) {
    const { mime, buf } = decodeDataURL(it.dataUrl);
    if (!buf?.length) throw new Error("bad_data_url");
    const p = path.join(tmpDir, `in-${i}${guessExt(it.name, mime)}`);
    fs.writeFileSync(p, buf);
    return p;
  }
  if (it?.url && it.url.startsWith("/")) {
    const src = path.join(process.cwd(), "public", it.url);
    const p = path.join(tmpDir, `in-${i}${guessExt(it.name, it.mime)}`);
    fs.copyFileSync(src, p);
    return p;
  }
  throw new Error("missing_input");
}
function fitDims(sw:number, sh:number) {
  const arS = sw/sh, arO = WIDTH/HEIGHT;
  if (arS >= arO) {
    const fw = WIDTH;
    const fh = Math.max(2, Math.floor((WIDTH/arS)/2)*2);
    return { fw, fh };
  }
  const fh = HEIGHT;
  const fw = Math.max(2, Math.floor((HEIGHT*arS)/2)*2);
  return { fw, fh };
}
function vfImage(dur:number, motion:string, rot:number, sw:number, sh:number, blur:boolean){
  const rotated = rot===90||rot===270;
  const rw = rotated? sh : sw;
  const rh = rotated? sw : sh;
  const { fw, fh } = fitDims(rw, rh);
  const frames = Math.max(2, Math.round(dur*FPS));
  const maxIdx = frames-1;
  const DZ = 0.20;
  const zin  = `1.00+${DZ.toFixed(2)}*(n/${maxIdx})`;
  const zout = `1.20-${DZ.toFixed(2)}*(n/${maxIdx})`;
  const zpan = `1.08`;
  const rotVF = rot===90? "transpose=1," : rot===180? "transpose=1,transpose=1," : rot===270? "transpose=2," : "";
  let fgAnim = "[fg0]copy[fgi]";
  if (motion==="zoom_in")   fgAnim = `[fg0]scale=w='iw*(${zin})':h='ih*(${zin})':eval=frame,crop=${fw}:${fh}:x='(iw-ow)/2':y='(ih-oh)/2'[fgi]`;
  if (motion==="zoom_out")  fgAnim = `[fg0]scale=w='iw*(${zout})':h='ih*(${zout})':eval=frame,crop=${fw}:${fh}:x='(iw-ow)/2':y='(ih-oh)/2'[fgi]`;
  if (motion==="pan_left")  fgAnim = `[fg0]scale=w='iw*(${zpan})':h='ih*(${zpan})':eval=frame,crop=${fw}:${fh}:x='(iw-ow)/2-(iw-ow)/2*(n/${maxIdx})':y='(ih-oh)/2'[fgi]`;
  if (motion==="pan_right") fgAnim = `[fg0]scale=w='iw*(${zpan})':h='ih*(${zpan})':eval=frame,crop=${fw}:${fh}:x='(iw-ow)/2+(iw-ow)/2*(n/${maxIdx})':y='(ih-oh)/2'[fgi]`;
  const fin=0.25, fout=Math.max(0.25, Math.min(0.6, dur*0.15));
  const bgBase = blur
    ? `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:flags=${SWS},crop=${WIDTH}:${HEIGHT},gblur=sigma=36`
    : `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:flags=${SWS},crop=${WIDTH}:${HEIGHT}`;
  return `${rotVF}setsar=1,split=2[bg][fg];[bg]${bgBase},setsar=1[bg];[fg]scale=${fw}:${fh},setsar=1[fg0];${fgAnim};[bg][fgi]overlay=(W-w)/2:(H-h)/2,fade=t=in:st=0:d=${fin},fade=t=out:st=${(dur-fout).toFixed(2)}:d=${fout},fps=${FPS},format=yuv420p`;
}
async function makeImageSegment(input:string, out:string, dur:number, blur:boolean, motion:string){
  const p = await probeVideo(input);
  const vf = vfImage(dur, motion, p.rot, p.w, p.h, blur);
  await runFF([
    "-y","-loop","1","-framerate",String(FPS),"-t",String(dur),"-i",input,
    "-f","lavfi","-t",String(dur),"-i","anullsrc=channel_layout=stereo:sample_rate=44100",
    "-filter_complex", vf+"[v]", "-map","[v]","-map","1:a",
    "-c:v","libx264","-preset",PRESET,"-crf",CRF,"-pix_fmt","yuv420p","-r",String(FPS),
    "-c:a","aac","-b:a","160k","-shortest", out
  ]);
}
function baseFitVideo(blur:boolean){
  if(!blur) return `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease:flags=${SWS},pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2`;
  return [
    `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease:flags=${SWS}[fit]`,
    `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:flags=${SWS},crop=${WIDTH}:${HEIGHT},gblur=sigma=36[bg]`,
    `[bg][fit]overlay=(W-w)/2:(H-h)/2`
  ].join(";");
}
async function makeVideoSegment(input:string, out:string, keepAudio:boolean, blur:boolean, cap?:number){
  const vf = `${baseFitVideo(blur)},fps=${FPS},format=yuv420p,setsar=1`;
  const args: string[] = ["-y"];
  if (cap && cap>0) args.push("-t", String(cap));
  args.push("-i", input);
  if (keepAudio) {
    args.push("-filter_complex", `[0:v]${vf}[v]`, "-map","[v]","-map","0:a?",
      "-c:v","libx264","-preset",PRESET,"-crf",CRF,"-pix_fmt","yuv420p","-r",String(FPS),
      "-c:a","aac","-ac","2","-ar","44100","-b:a","160k","-shortest", out);
  } else {
    args.push("-f","lavfi","-t", cap? String(cap):"9999","-i","anullsrc=channel_layout=stereo:sample_rate=44100",
      "-filter_complex",`[0:v]${vf}[v]`,"-map","[v]","-map","1:a",
      "-c:v","libx264","-preset",PRESET,"-crf",CRF,"-pix_fmt","yuv420p","-r",String(FPS),
      "-c:a","aac","-ac","2","-ar","44100","-b:a","160k","-shortest", out);
  }
  await runFF(args);
}
async function concatList(list:string[], out:string){
  const fileList = list.map(p => `file '${fwd(path.resolve(p))}'`).join("\n");
  const listPath = path.join(path.dirname(out), "concat.txt");
  fs.writeFileSync(listPath, fileList, "utf8");
  await runFF(["-y","-f","concat","-safe","0","-i",listPath,"-c","copy",out]);
  try { fs.unlinkSync(listPath); } catch {}
}
async function replaceAudio(video:string, music:string){
  const out = video.replace(/\.mp4$/i, "-music.mp4");
  await runFF(["-y","-stream_loop","-1","-i",music,"-i",video,
    "-map","1:v:0","-map","0:a:0","-c:v","copy","-c:a","aac","-b:a","192k","-shortest", out]);
  return out;
}

let processing = false;
const boot = (global as any);
if (!boot.__reel_worker_booted) {
  boot.__reel_worker_booted = true;
  setInterval(() => void tick().catch(()=>{}), 1500); // check often, cheap when idle
}

async function tick() {
  if (processing) return;
  processing = true;
  try {
    const job = await prisma.renderJob.findFirst({
      where: { status: "QUEUED" },
      orderBy: { createdAt: "asc" },
    });
    if (!job) return;

    await prisma.renderJob.update({ where: { id: job.id }, data: { status: "RUNNING", error: null } });

    const rdir = rendersDir();
    const tmp = path.join(rdir, `tmp-${job.id}`);
    ensureDir(tmp);

    // read inputs
    const opts = (job.options as any) || {};
    const items = (job.items as any[]) || [];
    if (!Array.isArray(items) || items.length===0) throw new Error("no_items");

    const segs:string[] = [];
    for (let i=0;i<items.length;i++){
      const src = await writeIncoming(tmp, items[i], i);
      const ext = path.extname(src).toLowerCase();
      const seg = path.join(tmp, `seg-${i}.mp4`);
      if ([".png",".jpg",".jpeg",".webp",".heic",".heif"].includes(ext)) {
        const p = await probeVideo(src); // harmless for stills
        await makeImageSegment(src, seg, Number(opts.durationSec ?? 2.5), !!opts.bgBlur, String(opts.motion||"zoom_in"));
      } else {
        await makeVideoSegment(src, seg, !!opts.keepVideoAudio, !!opts.bgBlur, Number(opts.maxPerVideoSec||0)||undefined);
      }
      segs.push(seg);
    }

    const out = path.join(rdir, `reel-${job.id}.mp4`);
    await concatList(segs, out);

    let final = out;
    const music = opts?.music?.dataUrl ? decodeDataURL(opts.music.dataUrl).buf : null;
    if (music && music.length) {
      const mPath = path.join(tmp, `music${guessExt(opts.music.name, "audio/m4a")}`);
      fs.writeFileSync(mPath, music);
      final = await replaceAudio(out, mPath);
      try { fs.unlinkSync(out); } catch {}
    }

    // tidy
    try {
      for (const s of segs) fs.unlinkSync(s);
      const rest = fs.readdirSync(tmp);
      for (const f of rest) fs.unlinkSync(path.join(tmp,f));
      fs.rmdirSync(tmp);
    } catch {}

    await prisma.renderJob.update({
      where: { id: job.id },
      data: { status: "DONE", outputUrl: `/renders/${path.basename(final)}`, error: null },
    });
  } catch (e:any) {
    console.error("WORKER_FAIL", e?.message || e);
    // best effort: mark current job failed
    try {
      const running = await prisma.renderJob.findFirst({ where: { status: "RUNNING" }, orderBy: { updatedAt: "desc" }});
      if (running) await prisma.renderJob.update({ where: { id: running.id }, data: { status: "FAILED", error: String(e?.message||e) }});
    } catch {}
  } finally {
    processing = false;
  }
}