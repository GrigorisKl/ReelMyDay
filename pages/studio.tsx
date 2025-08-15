// pages/studio.tsx
import React, { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import toast, { Toaster } from "react-hot-toast";
import { useSession, signIn } from "next-auth/react";

type Item = {
  name?: string;
  mime?: string;
  dataUrl?: string; // images
  url?: string;     // videos (uploaded)
};

type MotionKind = "cover" | "zoom_in" | "zoom_out" | "pan_left" | "pan_right";

export default function Studio() {
  const { status } = useSession();

  const [items, setItems] = useState<Item[]>([]);
  const [durationSec, setDurationSec] = useState(2.5);
  const [maxPerVideoSec, setMaxPerVideoSec] = useState(0);
  const [keepVideoAudio, setKeepVideoAudio] = useState(true);
  const [bgBlur, setBgBlur] = useState(true);
  const [motionKind, setMotionKind] = useState<MotionKind>("zoom_in");

  const [bgMusicUrl, setBgMusicUrl] = useState<string | null>(null);
  const [bgMusicName, setBgMusicName] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [inlineMsg, setInlineMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const musicInputRef = useRef<HTMLInputElement | null>(null);

  const counts = useMemo(() => {
    let images = 0, videos = 0;
    for (const it of items) {
      if (it.dataUrl) images++;
      else if (it.url) videos++;
    }
    return { images, videos, total: items.length };
  }, [items]);

  const hasVideo = counts.videos > 0;

  function browseFiles() { fileInputRef.current?.click(); }
  function browseMusic() {
    // Always clickable: if keepVideoAudio is on, we gently turn it off and then open the picker.
    if (keepVideoAudio) {
      setKeepVideoAudio(false);
      toast("Turned off “Keep original audio” to use background music.", { icon: "🎵" });
      setTimeout(() => musicInputRef.current?.click(), 0);
      return;
    }
    musicInputRef.current?.click();
  }

  async function onFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const inputEl = e.currentTarget;
    const files = inputEl.files;
    if (!files || !files.length) return;

    const toastId = toast.loading("Adding media…");
    const next: Item[] = [];
    try {
      for (const file of Array.from(files)) {
        if (file.type.startsWith("image/")) {
          const dataUrl = await fileToDataUrl(file);
          next.push({ name: file.name, mime: file.type, dataUrl });
        } else if (file.type.startsWith("video/")) {
          const url = await uploadFile(file);
          next.push({ name: file.name, mime: file.type, url });
        }
      }
      setItems((prev) => [...prev, ...next]);
      toast.success("Media added", { id: toastId });
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Failed to add media", { id: toastId });
    } finally {
      inputEl.value = "";
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function onMusicSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const inputEl = e.currentTarget;
    const files = inputEl.files;
    if (!files || !files.length) return;

    const f = files[0];
    if (!f.type.startsWith("audio/")) {
      toast.error("Please choose an audio file (mp3/m4a/wav).");
      inputEl.value = "";
      return;
    }
    const toastId = toast.loading("Uploading music…");
    try {
      const url = await uploadFile(f);
      setBgMusicUrl(url);
      setBgMusicName(f.name);
      toast.success("Music added", { id: toastId });
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Music upload failed", { id: toastId });
    } finally {
      inputEl.value = "";
      if (musicInputRef.current) musicInputRef.current.value = "";
    }
  }

  function removeItem(i: number) { setItems((prev) => prev.filter((_, idx) => idx !== i)); }
  function clearMusic() { setBgMusicUrl(null); setBgMusicName(null); }

  async function renderNow() {
    if (!items.length) {
      setInlineMsg("Please add at least one image or video.");
      return;
    }
    // Block conflicting audio choices
    if (bgMusicUrl && keepVideoAudio) {
      toast.error("You added music but also enabled “Keep original audio”. Turn one of them off.");
      return;
    }

    setInlineMsg(null);
    setRenderUrl(null);
    const toastId = toast.loading("Rendering…");
    setBusy(true);

    try {
      const r = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          durationSec,
          maxPerVideoSec,
          keepVideoAudio: hasVideo ? keepVideoAudio : false, // ignore if no video
          bgBlur,
          motion: motionKind,
          bgMusicUrl, // used only if keepVideoAudio === false
        }),
      });

      if (r.status === 401) {
        toast.dismiss(toastId);
        toast("Please sign in to export.", { icon: "🔒" });
        await signIn(undefined, { callbackUrl: "/studio" });
        setBusy(false);
        return;
      }
      if (r.status === 402) {
        const j = await r.json().catch(() => ({}));
        toast.dismiss(toastId);
        toast(j?.message || "Subscribe to continue.", { icon: "💳" });
        setBusy(false);
        return;
      }

      const j = await r.json().catch(() => ({}));
      setBusy(false);
      if (!r.ok || !j?.ok) {
        const m = j?.message || j?.details || "Render failed.";
        toast.error(m, { id: toastId });
        setInlineMsg(m);
        return;
      }

      setRenderUrl(j.url);
      toast.success("Done!", { id: toastId });
    } catch (e: any) {
      console.error(e);
      setBusy(false);
      toast.error(e?.message || "Unexpected error", { id: toastId });
      setInlineMsg(e?.message || "Unexpected error.");
    }
  }

  return (
    <main className="min-h-[80vh] mx-auto max-w-4xl px-4 py-8">
      <Toaster position="top-center" />

      <div className="flex items-center justify-between gap-3">
        <motion.h1 className="text-2xl font-semibold" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          ReelMyDay - Studio
        </motion.h1>
        <div className="text-sm text-black/60">{status === "authenticated" ? "Signed in" : "Guest"}</div>
      </div>

      <div className="mt-6 grid gap-6">
        {/* Picker */}
        <div className="card p-4">
          <label className="block text-sm font-medium">Add media (images & videos)</label>
          <div className="mt-2 flex items-center gap-3">
            <button type="button" onClick={browseFiles} className="rounded-2xl bg-pink-500 text-white px-4 py-2 font-medium hover:bg-pink-400">
              Choose files
            </button>
            <span className="text-sm text-black/60">
              {counts.total ? `${counts.total} selected — ${counts.images} images, ${counts.videos} videos` : "No files yet"}
            </span>
          </div>
          <input ref={fileInputRef} className="hidden" type="file" accept="image/*,video/*" multiple onChange={onFilesSelected} />
          {items.length > 0 && (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
              {items.map((it, i) => (
                <div key={i} className="relative rounded-lg overflow-hidden border border-black/10">
                  {it.dataUrl ? <img src={it.dataUrl} alt={it.name || ""} className="w-full h-44 object-contain bg-neutral-100" /> : <video src={it.url} className="w-full h-44 object-contain bg-neutral-100" muted controls />}
                  <button className="absolute top-1 right-1 bg-white/90 rounded px-2 py-1 text-xs shadow" onClick={() => removeItem(i)}>Remove</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Background music */}
        <div className="card p-4">
          <label className="block text-sm font-medium">Background music (mp3/m4a/wav)</label>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={browseMusic}
              className="rounded-2xl bg-indigo-500 text-white px-4 py-2 font-medium hover:bg-indigo-400"
            >
              {bgMusicName ? "Replace track" : "Choose audio"}
            </button>
            {bgMusicName && (
              <>
                <span className="text-sm">{bgMusicName}</span>
                <button className="text-sm underline" onClick={clearMusic}>Remove</button>
              </>
            )}
            <span className="text-xs text-black/60">
              If “Keep original audio from videos” is ON, we’ll turn it OFF so your music plays.
            </span>
          </div>
          <input ref={musicInputRef} className="hidden" type="file" accept="audio/*" onChange={onMusicSelected} />
        </div>

        {/* Options */}
        <div className="card p-4 grid gap-3 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium">Per-image duration (seconds)</label>
            <input type="number" step="0.1" min="0.5" className="mt-1 w-full rounded border border-black/10 px-2 py-1"
              value={durationSec} onChange={(e) => setDurationSec(parseFloat(e.target.value || "2.5"))} />
          </div>

          <div>
            <label className="block text-sm font-medium">Max per-video length (seconds, 0 = full)</label>
            <input type="number" step="1" min="0" className="mt-1 w-full rounded border border-black/10 px-2 py-1"
              value={maxPerVideoSec} onChange={(e) => setMaxPerVideoSec(parseInt(e.target.value || "0", 10))} />
          </div>

          <div>
            <label className="block text-sm font-medium">Image motion</label>
            <select className="mt-1 w-full rounded border border-black/10 px-2 py-2"
              value={motionKind} onChange={(e) => setMotionKind(e.target.value as MotionKind)}>
              <option value="zoom_in">Zoom in (subtle)</option>
              <option value="zoom_out">Zoom out</option>
              <option value="pan_left">Pan left</option>
              <option value="pan_right">Pan right</option>
              <option value="cover">Static (no motion)</option>
            </select>
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={hasVideo ? keepVideoAudio : false}
              onChange={(e) => setKeepVideoAudio(e.target.checked)}
              disabled={!hasVideo}
            />
            <span className={hasVideo ? "" : "opacity-60"} title={hasVideo ? "" : "Add a video to enable this."}>
              Keep original audio from videos
            </span>
          </label>

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={bgBlur} onChange={(e) => setBgBlur(e.target.checked)} />
            Background blur (for videos)
          </label>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <motion.button onClick={renderNow} disabled={busy || items.length === 0} whileTap={{ scale: 0.98 }}
            className="rounded-2xl bg-pink-500 text-white px-4 py-2 font-medium hover:bg-pink-400 disabled:opacity-60">
            {busy ? "Rendering…" : "Create Reel"}
          </motion.button>
          {renderUrl && (
            <a href={renderUrl} download className="rounded-2xl bg-white border border-black/10 px-4 py-2 font-medium hover:bg-white/80">
              Download MP4
            </a>
          )}
        </div>

        {bgMusicUrl && <p className="text-xs text-black/60">🎵 Music selected: {bgMusicName}</p>}
        {inlineMsg && <p className="text-sm text-black/70">{inlineMsg}</p>}
      </div>
    </main>
  );
}

async function uploadFile(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch("/api/upload", { method: "POST", body: fd });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Upload failed (${r.status}) ${t || ""}`);
  }
  const j = await r.json().catch(() => ({}));
  if (!j?.ok || !j?.url) throw new Error("Upload failed");
  return j.url as string;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}