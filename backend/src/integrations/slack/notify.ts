import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../config/db.js";
import { redis } from "../../config/redis.js";
import { decrypt } from "../../utils/crypto.js";
import { slackQueue } from "../../queues/index.js";
import { SLACK_OUTBOX, type RateEvent } from "../../services/rate-limit.js";

export async function dispatchSlackOutbox() {
  const events = await redis.hgetall(SLACK_OUTBOX);
  for (const [eventId, payload] of Object.entries(events)) {
    const job = await slackQueue.getJob(`slack-${eventId}`);
    if (job && (await job.getState()) === "failed") await job.retry();
    else if (!job)
      await slackQueue.add("rate-limit", JSON.parse(payload) as RateEvent, {
        jobId: `slack-${eventId}`,
      });
  }
}

export async function notifyRateLimit(event: RateEvent) {
  const key = `reachinbox:slack-notified:${event.eventId}`;
  if ((await redis.get(key)) === "sent") {
    await redis.hdel(SLACK_OUTBOX, event.eventId);
    return;
  }
  const integration = await prisma.slackIntegration.findUnique({
    where: { userId: event.userId },
  });
  // A connection is looked up per event, so later connects take effect without a restart.
  if (!integration) {
    await redis.hdel(SLACK_OUTBOX, event.eventId);
    return;
  }
  const token = randomUUID();
  if (!(await redis.set(key, token, "EX", 60, "NX")))
    throw new Error("Slack notification is already in progress");
  try {
    const digest = createHash("sha256").update(event.eventId).digest("hex");
    const clientMessageId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${decrypt(integration.accessTokenEncrypted)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: integration.channelId,
        client_msg_id: clientMessageId,
        text: `ReachInbox: ${event.senderEmail} reached its hourly limit of ${event.limit} SMTP attempts. The next available sending window starts ${new Date(event.nextAvailable).toISOString()}. Pending emails remain scheduled.`,
      }),
    });
    const result = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok)
      throw new Error(
        `Slack notification failed: ${result.error ?? response.status}`,
      );
    await redis.set(key, "sent", "EX", 7 * 86400);
    await redis.hdel(SLACK_OUTBOX, event.eventId);
  } catch (error) {
    await redis
      .eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
        1,
        key,
        token,
      )
      .catch(() => {});
    throw error;
  }
}
