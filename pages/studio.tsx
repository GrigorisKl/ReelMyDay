// pages/studio.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

type MediaItem = {
  file: File;
  kind: "image" | "video";
  name: string;
  previewUrl: string; // objectURL for <img>/<video>
  dataUrl?: string;   // base64 we POST
};

export default function Studio() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [musicFile, setMusicFile] = useState<File | null>(null);
  const [musicDur, setMusicDur] = useState<number>(0);

  const [durationSec, setDurationSec] = useState("2.5");
  const [maxPerVideoSec, setMaxPerVideoSec] = useState("0");
  const [keepVideoAudio, setKeepVideoAudio] = useState(false);
  const [bgBlur, setBgBlur] = useState(true);
  const [motion, setMotion] = useState<"zoom_in"|"zoom_out"|"pan_left"|"pan_right"|"cover">("zoom_in");
  const [matchMusicDuration, setMatchMusicDuration] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    const next: MediaItem[] = files.map((f) => {
      const kind = f.type.startsWith("video/") ? "video" : "image";
      return {
        file: f,
        kind,
        name: f.name,
        previewUrl: URL.createObjectURL(f),
      };
    });
    setItems((prev) => [...prev, ...next]);
    e.target.value = "";
  }

  function onPickAudio(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] || null;
    setMusicFile(f);
    setMusicDur(0);
    if (f) {
      const url = URL.createObjectURL(f);
      const a = new Audio();
      a.src = url;
      a.onloadedmetadata = () => {
        setMusicDur(a.duration || 0);
        URL.revokeObjectURL(url);
      };
    }
    e.target.value = "";
  }

  function removeAt(i: number) {
    setItems((prev) => {
      const copy = [...prev];
      const it = copy[i];
      if (it?.previewUrl) URL.revokeObjectURL(it.previewUrl);
      copy.splice(i, 1);
      return copy;
    });
  }

  // suggestion: how many stills fit in music length (rough; videos counted via max cap)
  const suggestedCount = useMemo(() => {
    const imgCount = items.filter((x) => x.kind === "image").length;
    const vidCount = items.filter((x) => x.kind === "video").length;
    const perImg = Number(durationSec) || 2.5;
    const cap = Number(maxPerVideoSec) || 0;
    if (!musicDur || perImg <= 0) return 0;

    // very rough: videos eat either cap or 3s each
    const vidBudget = vidCount * (cap > 0 ? cap : 3);
    const remain = Math.max(0, musicDur - vidBudget);
    return Math.max(0, Math.floor(remain / perImg));
  }, [items, musicDur, durationSec, maxPerVideoSec]);

  async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error("read_fail"));
      fr.onload = () => resolve(String(fr.result));
      fr.readAsDataURL(file);
    });
  }

  async function submit() {
    try {
      if (items.length === 0) {
        toast.error("Pick some files first.");
        return;
      }
      toast.dismiss();
      toast.loading("Rendering…");

      // turn all into dataUrls (server expects dataUrl or url)
      const payloadItems = await Promise.all(
        items.map(async (m) => ({
          name: m.name,
          dataUrl: await fileToDataUrl(m.file),
        }))
      );

      const music = musicFile
        ? { name: musicFile.name, dataUrl: await fileToDataUrl(musicFile) }
        : undefined;

      const r = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: payloadItems,
          durationSec: Number(durationSec) || 2.5,
          maxPerVideoSec: Number(maxPerVideoSec) || 0,
          keepVideoAudio,
          bgBlur,
          motion,
          music,                    // new: send the music blob
          matchMusicDuration,       // new: optional clamp
        }),
      });

      const j = await r.json().catch(() => ({}));
      toast.dismiss();
      if (!r.ok || !j?.ok) {
        console.error("RENDER_FAIL", j);
        toast.error(j?.message || j?.error || "Render failed.");
        return;
      }
      toast.success("Done! Opening…");
      window.location.href = j.url; // open the reel
    } catch (e) {
      console.error(e);
      toast.dismiss();
      toast.error("Render failed.");
    }
  }

  return (
    <section className="mt-6">
      {/* MEDIA */}
      <div className="card p-5">
        <h2 className="text-lg font-semibold">Add media (images & videos)</h2>
        <div className="mt-2 flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={onPickFiles}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded-2xl bg-pink-500 text-white px-4 py-2 font-medium hover:bg-pink-400"
          >
            Choose files
          </button>
          <p className="text-sm text-black/70">
            {items.length > 0
              ? `${items.length} selected — ${items.filter(i=>i.kind==='image').length} images, ${items.filter(i=>i.kind==='video').length} videos`
              : "No files yet"}
          </p>
        </div>

        {items.length > 0 && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
            {items.map((m, i) => (
              <div key={i} className="relative rounded-xl overflow-hidden border border-black/10 bg-white/60">
                {m.kind === "image" ? (
                  <img src={m.previewUrl} className="w-full h-[220px] object-cover" alt={m.name} />
                ) : (
                  <video
                    src={m.previewUrl}
                    className="w-full h-[220px] object-cover"
                    muted
                    playsInline
                    loop
                    onCanPlay={(e)=> (e.currentTarget as HTMLVideoElement).play().catch(()=>{})}
                  />
                )}
                <button
                  onClick={() => removeAt(i)}
                  className="absolute top-2 right-2 text-xs rounded-full bg-white/80 px-2 py-1"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MUSIC */}
      <div className="card p-5 mt-4">
        <h2 className="text-lg font-semibold">Background music (mp3/m4a/wav)</h2>
        <div className="mt-2 flex items-center gap-3">
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={onPickAudio}
          />
          <button
            onClick={() => audioInputRef.current?.click()}
            className="rounded-2xl bg-indigo-500 text-white px-4 py-2 font-medium hover:bg-indigo-400"
          >
            Choose audio
          </button>
          {musicFile && (
            <span className="text-sm text-black/70">
              {musicFile.name} {musicDur ? `• ${musicDur.toFixed(1)}s` : ""}
            </span>
          )}
        </div>

        <div className="mt-2 text-sm text-black/60">
          If “Keep original audio from videos” is ON, we’ll turn it OFF so your music plays.
        </div>
      </div>

      {/* OPTIONS */}
      <div className="card p-5 mt-4">
        <div className="grid md:grid-cols-2 gap-4">
          <label className="block">
            <div className="text-sm text-black/70">Per-image duration (seconds)</div>
            <input
              value={durationSec}
              onChange={(e)=>setDurationSec(e.target.value)}
              className="mt-1 w-full rounded-xl bg-white/70 border border-black/10 px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <div className="text-sm text-black/70">Max per-video length (seconds, 0 = full)</div>
            <input
              value={maxPerVideoSec}
              onChange={(e)=>setMaxPerVideoSec(e.target.value)}
              className="mt-1 w-full rounded-xl bg-white/70 border border-black/10 px-3 py-2 text-sm"
            />
          </label>
        </div>

        <div className="mt-3 grid md:grid-cols-2 gap-4">
          <label className="block">
            <div className="text-sm text-black/70">Image motion</div>
            <select
              value={motion}
              onChange={(e)=>setMotion(e.target.value as any)}
              className="mt-1 w-full rounded-xl bg-white/70 border border-black/10 px-3 py-2 text-sm"
            >
              <option value="zoom_in">Zoom in (subtle)</option>
              <option value="zoom_out">Zoom out (subtle)</option>
              <option value="pan_left">Pan left</option>
              <option value="pan_right">Pan right</option>
              <option value="cover">No motion</option>
            </select>
          </label>

          <label className="flex items-center gap-2 mt-7">
            <input type="checkbox" checked={keepVideoAudio} onChange={(e)=>setKeepVideoAudio(e.target.checked)} />
            <span>Keep original audio from videos</span>
          </label>
        </div>

        <label className="flex items-center gap-2 mt-3">
          <input type="checkbox" checked={bgBlur} onChange={(e)=>setBgBlur(e.target.checked)} />
          <span>Background blur (for videos)</span>
        </label>

        <label className="flex items-center gap-2 mt-3">
          <input
            type="checkbox"
            checked={matchMusicDuration}
            onChange={(e)=>setMatchMusicDuration(e.target.checked)}
            disabled={!musicFile}
          />
          <span>Auto-match reel length to music {musicFile ? "" : "(choose a track first)"}</span>
        </label>

        {matchMusicDuration && musicDur > 0 && (
          <p className="mt-1 text-xs text-black/60">
            Suggestion: ~{suggestedCount} images (plus your videos) fits {musicDur.toFixed(0)}s at {durationSec}s per image.
          </p>
        )}
      </div>

      <div className="mt-4">
        <button
          onClick={submit}
          className="rounded-2xl bg-pink-500 text-white px-5 py-2 font-semibold hover:bg-pink-400"
        >
          Create Reel
        </button>
      </div>
    </section>
  );
}