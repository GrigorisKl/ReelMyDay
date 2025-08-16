// lib/render-worker.ts
import { prisma } from "./prisma";
import type { RenderJobStatus } from "@prisma/client";

// Typed enum values (your Prisma enum is lowercase)
const QUEUED: RenderJobStatus = "queued";
const FAILED: RenderJobStatus = "failed";

// ensure single interval per process
const g = global as unknown as { __renderWorkerBooted?: boolean };
if (!g.__renderWorkerBooted) {
  g.__renderWorkerBooted = true;
  setInterval(() => {
    tick().catch((err) =>
      console.error("render-worker tick error:", err?.message || err)
    );
  }, 15000);
}

async function tick() {
  // Find the oldest queued job (if any)
  const job = await prisma.renderJob.findFirst({
    where: { status: QUEUED },
    orderBy: { createdAt: "asc" },
  });
  if (!job) return;

  // Your app renders directly via /api/render for now.
  await prisma.renderJob.update({
    where: { id: job.id },
    data: {
      status: FAILED,
      error:
        "Background worker is not enabled to process queued jobs. The app renders directly via /api/render.",
    },
  });
}