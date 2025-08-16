// lib/render-worker.ts
/**
 * Minimal, safe worker:
 * - Compiles against a RenderJob model WITHOUT startedAt/finishedAt/options
 * - Never references unknown constants like RENDERS_FILE
 * - If a queued job is found, mark it failed with a helpful message
 *   (your app currently renders synchronously via /api/render)
 */

import { prisma } from "./prisma";

// ensure single interval per process
const g = global as unknown as { __renderWorkerBooted?: boolean };
if (!g.__renderWorkerBooted) {
  g.__renderWorkerBooted = true;
  // tick every 15s; extremely cheap
  setInterval(() => void tick().catch(() => {}), 15000);
}

async function tick() {
  // find the oldest queued job (if any)
  const job = await prisma.renderJob.findFirst({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
  });
  if (!job) return;

  // Your app renders directly in /api/render for now, so queued jobs
  // shouldn't exist. Mark them failed with a clear message (and DO NOT
  // write fields that aren't in your schema, like startedAt/finishedAt).
  await prisma.renderJob.update({
    where: { id: job.id },
    data: {
      status: "failed",
      error:
        "Background worker is not enabled. The app renders directly via /api/render.",
    },
  });
}