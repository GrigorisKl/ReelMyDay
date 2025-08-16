// pages/api/render-status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import { prisma } from "../../lib/prisma";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // No caching — avoids 304/empty-body issues during polling
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");

  if (req.method !== "GET") return res.status(405).end();

  const session = (await getServerSession(req, res, authOptions as any)) as Session | null;
  const email = session?.user?.email ?? null;
  if (!email) return res.status(401).json({ ok: false });

  const id = String(req.query.jobId || "");
  if (!id) return res.status(400).json({ ok: false, error: "missing_jobId" });

  const job = await prisma.renderJob.findUnique({ where: { id } });
  if (!job || job.userEmail.toLowerCase() !== email.toLowerCase()) {
    return res.status(404).json({ ok: false });
  }

  return res.json({
    ok: true,
    status: job.status,           // "QUEUED" | "RUNNING" | "DONE" | "FAILED"
    url: job.outputUrl ?? null,
    error: job.error ?? null,
  });
}