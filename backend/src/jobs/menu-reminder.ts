import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { hostMenuService } from "../modules/host/host-menu.service.js";

const QUEUE_NAME = "menu-reminder";
// Fire once daily at 07:00 India time: nudge hosts whose meal menu is still empty.
const REMINDER_CRON = "0 7 * * *";
const REMINDER_TZ = "Asia/Kolkata";

// BullMQ needs dedicated connections with maxRetriesPerRequest: null.
const connections: Redis[] = [];
function connection(): Redis {
  const conn = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  connections.push(conn);
  return conn;
}

let queue: Queue | undefined;
let worker: Worker | undefined;

/** Start the worker and schedule the 7am empty-menu reminder sweep. */
export async function startMenuReminder(): Promise<void> {
  queue = new Queue(QUEUE_NAME, { connection: connection() });
  worker = new Worker(
    QUEUE_NAME,
    async (_job: Job) => {
      const reminded = await hostMenuService.remindEmptyMenus();
      if (reminded > 0) logger.info({ reminded }, "empty-menu reminder sweep");
      return { reminded };
    },
    { connection: connection() },
  );
  worker.on("failed", (job, err) => {
    logger.error({ err, jobId: job?.id }, "menu-reminder job failed");
  });

  // Same repeat options => same repeat key, so re-adding on each boot is idempotent.
  await queue.add(
    "sweep",
    {},
    { repeat: { pattern: REMINDER_CRON, tz: REMINDER_TZ }, removeOnComplete: true, removeOnFail: 100 },
  );
  logger.info({ cron: REMINDER_CRON, tz: REMINDER_TZ }, "menu-reminder sweep scheduled");
}

export async function stopMenuReminder(): Promise<void> {
  await worker?.close();
  await queue?.close();
  await Promise.all(connections.map((conn) => conn.quit().catch(() => undefined)));
}
