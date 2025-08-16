// lib/render-worker.ts
import { prisma } from "./prisma";
type RenderJobStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED";

// Your schema has UPPERCASE enum values:
// enum RenderJobStatus { QUEUED RUNNING DONE FAILED }
const QUEUED: RenderJobStatus = "QUEUED";
const FAILED:  RenderJobStatus = "FAILED";

// guard so the interval isn’t registered twice in dev/hot reload
const g = global as unknown as { __renderWorkerBooted?: boolean };
if (!g.__renderWorkerBooted) {
  g.__renderWorkerBooted = true;
  setInterval(() => { void tick(); }, 15_000);
}

async function tick() {
  // Oldest queued job
  const job = await prisma.renderJob.findFirst({
    where: { status: QUEUED },
    orderBy: { createdAt: "asc" },
  });
  if (!job) return;

  // You currently render synchronously in /api/render
  await prisma.renderJob.update({
    where: { id: job.id },
    data: {
      status: FAILED,
      error:
        "Background worker not enabled to process queued jobs. The app renders directly via /api/render.",
    },
  });
}

export {};