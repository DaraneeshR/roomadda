import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { socialService } from "../modules/social/social.service.js";

const QUEUE_NAME = "social-booked";
// "Booked N times recently" only needs to be roughly fresh, so a 5-minute tick
// keeps it honest without hammering the DB. The recompute is idempotent (it
// fully rebuilds the cached counts each run).
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

// BullMQ needs dedicated connections with maxRetriesPerRequest: null.
const connections: Redis[] = [];
function connection(): Redis {
  const conn = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  connections.push(conn);
  return conn;
}

let queue: Queue | undefined;
let worker: Worker | undefined;

/** Start the worker and schedule the repeatable booked-count recompute. */
export async function startSocialBooked(): Promise<void> {
  queue = new Queue(QUEUE_NAME, { connection: connection() });
  worker = new Worker(
    QUEUE_NAME,
    async (_job: Job) => {
      const result = await socialService.recomputeBookedCounts();
      if (result.listingsWithActivity > 0) {
        logger.info(result, "social booked-count recompute");
      }
      return result;
    },
    { connection: connection() },
  );
  worker.on("failed", (job, err) => {
    logger.error({ err, jobId: job?.id }, "social-booked job failed");
  });

  // Same repeat options => same repeat key, so re-adding on each boot is idempotent.
  await queue.add(
    "sweep",
    {},
    { repeat: { every: SWEEP_INTERVAL_MS }, removeOnComplete: true, removeOnFail: 100 },
  );
  logger.info({ everyMs: SWEEP_INTERVAL_MS }, "social-booked recompute scheduled");
}

export async function stopSocialBooked(): Promise<void> {
  await worker?.close();
  await queue?.close();
  await Promise.all(connections.map((conn) => conn.quit().catch(() => undefined)));
}
