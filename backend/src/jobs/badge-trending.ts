import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { badgeService } from "../modules/badge/badge.service.js";

const QUEUE_NAME = "badge-trending";
// Trending momentum fades fast, so it is re-evaluated HOURLY (and expired links
// are swept in the same pass). Idempotent — it fully reconciles each run.
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

const connections: Redis[] = [];
function connection(): Redis {
  const conn = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  connections.push(conn);
  return conn;
}

let queue: Queue | undefined;
let worker: Worker | undefined;

/** Start the worker and schedule the repeatable Trending re-evaluation. */
export async function startBadgeTrending(): Promise<void> {
  queue = new Queue(QUEUE_NAME, { connection: connection() });
  worker = new Worker(
    QUEUE_NAME,
    async (_job: Job) => {
      const result = await badgeService.reevaluateTrendingAll();
      logger.info(result, "badge trending re-evaluation");
      return result;
    },
    { connection: connection() },
  );
  worker.on("failed", (job, err) => {
    logger.error({ err, jobId: job?.id }, "badge-trending job failed");
  });

  await queue.add(
    "sweep",
    {},
    { repeat: { every: SWEEP_INTERVAL_MS }, removeOnComplete: true, removeOnFail: 100 },
  );
  logger.info({ everyMs: SWEEP_INTERVAL_MS }, "badge-trending sweep scheduled");
}

export async function stopBadgeTrending(): Promise<void> {
  await worker?.close();
  await queue?.close();
  await Promise.all(connections.map((conn) => conn.quit().catch(() => undefined)));
}
