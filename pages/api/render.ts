// pages/api/render.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import { prisma } from "../../lib/prisma";

import * as fs from "node:fs";
import * as path from "node:path";

// ---------- simple usage gating (file-based counter) ----------
function ensureDir(p: string) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
const DATA_DIR = path.join(process.cwd(), "data");
const USAGE_FILE = path.join(DATA_DIR, "usage.json");
function readJSON<T = any>(file: string, fallback: T): T {
  try {
    ensureDir(DATA_DIR);
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8") || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(file: string, data: any) {
  try {
    ensureDir(DATA_DIR);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  } catch {}
}
function getCount(email: string) {
  const m = readJSON<Record<string, number>>(USAGE_FILE, {});
  return m[email.toLowerCase()] || 0;
}
function bumpCount(email: string) {
  const key = email.toLowerCase();
  const m = readJSON<Record<string, number>>(USAGE_FILE, {});
  m[key] = (m[key] || 0) + 1;
  writeJSON(USAGE_FILE, m);
}

// ---------- owner/pro ----------
const OWNER_EMAIL = (process.env.OWNER_EMAIL || "").toLowerCase();
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
  if (e === OWNER_EMAIL || envProEmails().has(e)) return true;
  try {
    const u = await prisma.user.findUnique({ where: { email: e }, select: { isPro: true } });
    return !!u?.isPro;
  } catch {
    return false;
  }
}

// ---------- payload guards (keep memory under control) ----------
const MAX_ITEMS = Number(process.env.RM_MAX_ITEMS || 40);
const MAX_TOTAL = Number(process.env.RM_MAX_TOTAL_BYTES || 250_000_000); // ~238MB
function approxBytesFromDataUrl(s: string) { // base64 size ≈ len*0.75 (minus header)
  const m = /^data:.*;base64,/.exec(s);
  const headLen = m ? m[0].length : 0;
  const b64 = s.slice(headLen);
  return Math.floor(b64.length * 0.75);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const session = (await getServerSession(req, res, authOptions as any)) as Session | null;
  const email = session?.user?.email || null;
  if (!email) return res.status(401).json({ ok: false, error: "not_signed_in" });

  // find the DB user (we need user.id for the relation)
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return res.status(401).json({ ok: false, error: "not_signed_in" });

  // free gating
  const pro = await isProEmail(email);
  if (!pro) {
    const used = getCount(email);
    if (used >= 1) return res.status(402).json({ ok: false, error: "free_limit_reached" });
  }

  try {
    const body = (req.body || {}) as {
      items: Array<{ name?: string; dataUrl?: string; url?: string; mime?: string }>;
      durationSec?: number;
      maxPerVideoSec?: number;
      keepVideoAudio?: boolean;
      bgBlur?: boolean;
      motion?: "zoom_in" | "zoom_out" | "pan_left" | "pan_right" | "cover";
      music?: { name?: string; dataUrl?: string } | null;
      matchMusicDuration?: boolean;
    };

    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return res.status(400).json({ ok: false, error: "no_items" });
    if (items.length > MAX_ITEMS) {
      return res.status(413).json({ ok: false, error: "too_many_items", limit: MAX_ITEMS });
    }

    // rough size check (dataURLs only) — avoids oversize payloads blowing memory
    let total = 0;
    for (const it of items) if (it?.dataUrl) total += approxBytesFromDataUrl(it.dataUrl);
    if (body.music?.dataUrl) total += approxBytesFromDataUrl(body.music.dataUrl);
    if (total > MAX_TOTAL) {
      return res.status(413).json({ ok: false, error: "payload_too_large", limit: MAX_TOTAL });
    }

    // enqueue job — THIS MATCHES the schema where RenderJob has:
    // userId (relation), userEmail (string), status (enum), items (Json), options (Json)
    const job = await prisma.renderJob.create({
      data: {
        status: "QUEUED",
        userId: user.id,                 // relation to User
        userEmail: email.toLowerCase(),  // keep for easy filtering
        items,
        options: {
          durationSec: Number(body.durationSec ?? 2.5),
          maxPerVideoSec: Number(body.maxPerVideoSec ?? 0),
          keepVideoAudio: !!body.keepVideoAudio,
          bgBlur: body.bgBlur !== false,
          motion: body.motion || "zoom_in",
          music: body.music || null,
          matchMusicDuration: !!body.matchMusicDuration,
        },
      },
      select: { id: true },
    });

    if (!pro) bumpCount(email);

    return res.json({ ok: true, jobId: job.id });
  } catch (e: any) {
    console.error("RENDER_ENQUEUE_FAIL", e?.message || e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}

// allow large image/audio dataURLs
export const config = { api: { bodyParser: { sizeLimit: "150mb" } } };