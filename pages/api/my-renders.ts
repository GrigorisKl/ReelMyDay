// pages/api/my-renders.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import * as fs from "node:fs";
import * as path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const RENDERS_FILE = path.join(DATA_DIR, "renders.json");

function ensureDir(p: string) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
function readRenders(): any[] {
  try {
    ensureDir(DATA_DIR);
    if (!fs.existsSync(RENTERS_FILE_FIX)) return [];
    const raw = fs.readFileSync(RENTERS_FILE_FIX, "utf8");
    return JSON.parse(raw || "[]");
  } catch { return []; }
}
const RENTERS_FILE_FIX = RENDERS_FILE;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = (await getServerSession(req, res, authOptions as any)) as Session | null;
  const email = session?.user?.email || null;
  if (!email) return res.status(401).json({ ok: false, error: "unauthorized" });

  const mine = readRenders()
    .filter((r) => String(r.email).toLowerCase() === email.toLowerCase())
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));

  return res.json({ ok: true, items: mine });
}