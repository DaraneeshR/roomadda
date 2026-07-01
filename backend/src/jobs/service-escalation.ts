import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { serviceRequestService } from "../modules/service-request/service-request.service.js";

const QUEUE_NAME = "service-escalation";
// Urgent requests escalate after 4h; a 15-min tick keeps escalation timely.
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

// BullMQ needs dedicated connections with maxRetriesPerRequest: null.
const connections: Redis[] = [];
function connection(): Redis {
  const conn = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  connections.push(conn);
  return conn;
}

let queue: Queue | undefined;
let worker: Worker | undefined;

/** Start the worker and schedule the repeatable Urgent-request escalation sweep. */
export async function startServiceEscalation(): Promise<void> {
  queue = new Queue(QUEUE_NAME, { connection: connection() });
  worker = new Worker(
    QUEUE_NAME,
    async (_job: Job) => {
      const escalated = await serviceRequestService.escalateOverdueUrgent();
      if (escalated > 0) logger.info({ escalated }, "escalated overdue urgent service requests");
      return { escalated };
    },
    { connection: connection() },
  );
  worker.on("failed", (job, err) => {
    logger.error({ err, jobId: job?.id }, "service-escalation job failed");
  });

  // Same repeat options => same repeat key, so re-adding on each boot is idempotent.
  await queue.add(
    "sweep",
    {},
    { repeat: { every: SWEEP_INTERVAL_MS }, removeOnComplete: true, removeOnFail: 100 },
  );
  logger.info({ everyMs: SWEEP_INTERVAL_MS }, "service-escalation sweep scheduled");
}

export async function stopServiceEscalation(): Promise<void> {
  await worker?.close();
  await queue?.close();
  await Promise.all(connections.map((conn) => conn.quit().catch(() => undefined)));
}
