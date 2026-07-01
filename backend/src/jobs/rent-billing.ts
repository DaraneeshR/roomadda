import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { rentService } from "../modules/rent/rent.service.js";

const QUEUE_NAME = "rent-billing";
// Rent is monthly, but generation/overdue are idempotent and cheap (they only
// act within the pay-ahead window), so an hourly tick keeps invoices timely
// without waiting up to a day.
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

// BullMQ needs dedicated connections with maxRetriesPerRequest: null.
const connections: Redis[] = [];
function connection(): Redis {
  const conn = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  connections.push(conn);
  return conn;
}

let queue: Queue | undefined;
let worker: Worker | undefined;

/** Start the worker and schedule the repeatable rent generation + overdue sweep. */
export async function startRentBilling(): Promise<void> {
  queue = new Queue(QUEUE_NAME, { connection: connection() });
  worker = new Worker(
    QUEUE_NAME,
    async (_job: Job) => {
      const generated = await rentService.generateDueRentInvoices();
      const overdue = await rentService.markOverdueInvoices();
      // Reminders run AFTER the overdue sweep so the DUE set excludes past-due.
      const reminded = await rentService.sendDueReminders();
      if (generated > 0 || overdue > 0 || reminded > 0) {
        logger.info({ generated, overdue, reminded }, "rent billing sweep");
      }
      return { generated, overdue, reminded };
    },
    { connection: connection() },
  );
  worker.on("failed", (job, err) => {
    logger.error({ err, jobId: job?.id }, "rent-billing job failed");
  });

  // Same repeat options => same repeat key, so re-adding on each boot is idempotent.
  await queue.add(
    "sweep",
    {},
    { repeat: { every: SWEEP_INTERVAL_MS }, removeOnComplete: true, removeOnFail: 100 },
  );
  logger.info({ everyMs: SWEEP_INTERVAL_MS }, "rent-billing sweep scheduled");
}

export async function stopRentBilling(): Promise<void> {
  await worker?.close();
  await queue?.close();
  await Promise.all(connections.map((conn) => conn.quit().catch(() => undefined)));
}
