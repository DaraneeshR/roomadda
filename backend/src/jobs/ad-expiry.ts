import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { adService } from "../modules/ad/ad.service.js";

const QUEUE_NAME = "ad-expiry";
const SWEEP_INTERVAL_MS = 60_000;

// BullMQ needs dedicated connections with maxRetriesPerRequest: null.
const connections: Redis[] = [];
function connection(): Redis {
  const conn = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  connections.push(conn);
  return conn;
}

let queue: Queue | undefined;
let worker: Worker | undefined;

/** Start the worker and schedule the repeatable ad-slot expiry sweep. */
export async function startAdExpiry(): Promise<void> {
  queue = new Queue(QUEUE_NAME, { connection: connection() });
  worker = new Worker(
    QUEUE_NAME,
    async (_job: Job) => {
      const expired = await adService.expireEndedAdSlots();
      if (expired > 0) logger.info({ expired }, "expired ended ad slots");
      return { expired };
    },
    { connection: connection() },
  );
  worker.on("failed", (job, err) => {
    logger.error({ err, jobId: job?.id }, "ad-expiry job failed");
  });

  // Same repeat options => same repeat key, so re-adding on each boot is idempotent.
  await queue.add(
    "sweep",
    {},
    { repeat: { every: SWEEP_INTERVAL_MS }, removeOnComplete: true, removeOnFail: 100 },
  );
  logger.info({ everyMs: SWEEP_INTERVAL_MS }, "ad-expiry sweep scheduled");
}

export async function stopAdExpiry(): Promise<void> {
  await worker?.close();
  await queue?.close();
  await Promise.all(connections.map((conn) => conn.quit().catch(() => undefined)));
}
