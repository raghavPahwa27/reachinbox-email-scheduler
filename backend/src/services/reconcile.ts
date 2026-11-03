import { Client } from "pg";
import { prisma } from "../config/db.js";
import { redis } from "../config/redis.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import {
  emailQueue,
  indexQueue,
  enqueueEmails,
  enqueueIndex,
} from "../queues/index.js";
import { dispatchSlackOutbox } from "../integrations/slack/notify.js";

let running: Promise<void> | undefined;
let fullScanRequested = false;
const pendingIds = new Set<string>();
/** No timers or polling: callers request a full recovery scan or notify specific durable rows. */
export function reconcile(ids?: string[]): Promise<void> {
  if (ids) ids.forEach((id) => pendingIds.add(id));
  else fullScanRequested = true;
  if (!running)
    running = (async () => {
      do {
        while (fullScanRequested || pendingIds.size) {
          if (fullScanRequested) {
            fullScanRequested = false;
            pendingIds.clear();
            await fullScan();
          } else {
            const batch = [...pendingIds].slice(0, 250);
            batch.forEach((id) => pendingIds.delete(id));
            await recoverRows(batch);
          }
        }
        await dispatchSlackOutbox();
      } while (fullScanRequested || pendingIds.size);
    })().finally(() => {
      running = undefined;
    });
  return running;
}
async function recoverRows(ids: string[]) {
  const rows = await prisma.email.findMany({ where: { id: { in: ids } } });
  const missing = [];
  const dirty = [];
  for (const email of rows) {
    if (email.status === "SCHEDULED" || email.status === "PROCESSING") {
      const job = await emailQueue.getJob(email.bullJobId);
      if (!job) missing.push(email);
      else if ((await job.getState()) === "failed") {
        await prisma.email.updateMany({
          where: { id: email.id, status: { in: ["SCHEDULED", "PROCESSING"] } },
          data: {
            status: "FAILED",
            errorMessage: job.failedReason || "Queue job failed",
            processingAt: null,
            indexDirty: true,
          },
        });
      }
    }
    if (email.indexDirty) {
      const job = await indexQueue.getJob(
        `index-${email.id}-${email.searchVersion}`,
      );
      if (job && (await job.getState()) === "failed") await job.retry();
      else if (!job) dirty.push(email);
    }
  }
  if (missing.length) await enqueueEmails(missing);
  if (dirty.length) await enqueueIndex(dirty);
}
async function fullScan() {
  let cursor: string | undefined;
  do {
    const rows = await prisma.email.findMany({
      where: {
        OR: [
          { status: { in: ["SCHEDULED", "PROCESSING"] } },
          { indexDirty: true },
        ],
      },
      orderBy: { id: "asc" },
      take: 250,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true },
    });
    if (!rows.length) break;
    await recoverRows(rows.map((email) => email.id));
    cursor = rows.at(-1)!.id;
  } while (true);
}

// Event-driven outbox wakeups. Startup and reconnection scans cover notifications missed while offline.
// The timeout below only reconnects a broken LISTEN socket; it is not a scheduler/polling loop.
export async function startRecoveryListener(): Promise<() => Promise<void>> {
  let stopped = false;
  let client: Client | undefined;
  let reconnect: NodeJS.Timeout | undefined;
  let connectPromise: Promise<void> | undefined;
  const wake = () => {
    void reconcile().catch((error) =>
      logger.warn(
        { err: error },
        "Recovery deferred until reconnect/startup/manual reconcile",
      ),
    );
  };
  const connect = async () => {
    const current = new Client({
      connectionString: env.DATABASE_URL,
      connectionTimeoutMillis: 10000,
    });
    client = current;
    const retry = () => {
      if (stopped || reconnect || client !== current) return;
      void current.end().catch(() => {});
      reconnect = setTimeout(() => {
        reconnect = undefined;
        connectPromise = connect();
        void connectPromise;
      }, 3000);
    };
    current.on("error", (error) => {
      logger.warn({ err: error }, "Postgres recovery listener disconnected");
      retry();
    });
    current.on("end", retry);
    current.on("notification", (notification) => {
      const ids =
        notification.payload && /^[a-f0-9-]{36}$/.test(notification.payload)
          ? [notification.payload]
          : undefined;
      void reconcile(ids).catch((error) =>
        logger.warn(
          { err: error },
          "Notification remains recoverable in database",
        ),
      );
    });
    try {
      await current.connect();
      await current.query("LISTEN reachinbox_work");
      wake();
    } catch (error) {
      logger.warn(
        { err: error },
        "Postgres recovery listener connection failed",
      );
      retry();
    }
  };
  redis.on("ready", wake);
  connectPromise = connect();
  await connectPromise;
  return async () => {
    stopped = true;
    redis.off("ready", wake);
    if (reconnect) clearTimeout(reconnect);
    await connectPromise;
    await client?.end().catch(() => {});
    await running?.catch(() => {});
  };
}
