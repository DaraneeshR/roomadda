import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { badgeService } from "../modules/badge/badge.service.js";

const QUEUE_NAME = "badge-durable";
// The durable badges (Verified / Assured / Choice / Luxury / Wizard) change
// slowly, so they are re-evaluated NIGHTLY. Idempotent full reconcile each run:
// it earns newly-eligible listings and REMOVES badges whose rules no longer hold.
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

const connections: Redis[] = [];
function connection(): Redis {
  const conn = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  connections.push(conn);
  return conn;
}

let queue: Queue | undefined;
let worker: Worker | undefined;

/** Start the worker and schedule the repeatable durable-badge re-evaluation. */
export async function startBadgeDurable(): Promise<void> {
  queue = new Queue(QUEUE_NAME, { connection: connection() });
  worker = new Worker(
    QUEUE_NAME,
    async (_job: Job) => {
      const result = await badgeService.reevaluateDurableAll();
      logger.info(result, "badge durable re-evaluation");
      return result;
    },
    { connection: connection() },
  );
  worker.on("failed", (job, err) => {
    logger.error({ err, jobId: job?.id }, "badge-durable job failed");
  });

  await queue.add(
    "sweep",
    {},
    { repeat: { every: SWEEP_INTERVAL_MS }, removeOnComplete: true, removeOnFail: 100 },
  );
  logger.info({ everyMs: SWEEP_INTERVAL_MS }, "badge-durable sweep scheduled");
}

export async function stopBadgeDurable(): Promise<void> {
  await worker?.close();
  await queue?.close();
  await Promise.all(connections.map((conn) => conn.quit().catch(() => undefined)));
}
