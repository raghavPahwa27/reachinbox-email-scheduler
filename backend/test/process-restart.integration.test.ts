import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

async function until(check: () => Promise<boolean>, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline)
      throw new Error("Process restart check timed out");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
async function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Process did not shut down gracefully"));
    }, 10000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

test(
  "actual API and worker processes restart without losing delayed jobs or reprocessing terminal rows",
  { skip: !process.env.DATABASE_TEST_URL || !process.env.REDIS_TEST_PORT },
  async () => {
    Object.assign(process.env, {
      DATABASE_URL: process.env.DATABASE_TEST_URL,
      REDIS_PORT: process.env.REDIS_TEST_PORT,
      REDIS_HOST: "127.0.0.1",
      JWT_SECRET: randomBytes(48).toString("base64"),
      ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      NODE_ENV: "test",
      PORT: "13001",
    });
    const { prisma } = await import("../src/config/db.js");
    const { redis } = await import("../src/config/redis.js");
    const { scheduleEmails } = await import("../src/services/scheduling.js");
    const { emailQueue, indexQueue, closeQueues } =
      await import("../src/queues/index.js");
    const cwd = fileURLToPath(new URL("..", import.meta.url));
    let api: ChildProcess | undefined;
    let worker: ChildProcess | undefined;
    const start = (file: string) =>
      spawn(process.execPath, ["--import", "tsx", `src/${file}.ts`], {
        cwd,
        env: {
          ...process.env,
          GOOGLE_CLIENT_ID: "",
          GOOGLE_CLIENT_SECRET: "",
          SLACK_CLIENT_ID: "",
          SLACK_CLIENT_SECRET: "",
        },
        stdio: "ignore",
      });
    const ready = () =>
      until(async () => {
        try {
          return (await fetch("http://127.0.0.1:13001/health/ready")).ok;
        } catch {
          return false;
        }
      });
    const marker = randomUUID();
    const user = await prisma.user.create({
      data: {
        googleId: marker,
        name: "Restart test",
        email: `${marker}@example.com`,
      },
    });
    const sender = await prisma.sender.create({
      data: {
        userId: user.id,
        name: "Restart test",
        email: `sender-${marker}@example.com`,
        smtpUser: "unused",
        smtpPasswordEncrypted: "invalid-no-external-send",
        hourlyLimit: 10,
        minDelaySeconds: 2,
      },
    });
    try {
      api = start("server");
      worker = start("worker");
      await ready();
      const due = Date.now() + 5000;
      const result = await scheduleEmails(
        user.id,
        {
          senderId: sender.id,
          subject: "Restart",
          body: "Test",
          recipients: ["test@example.com"],
          startTime: new Date(due).toISOString(),
          delaySeconds: 2,
          hourlyLimit: 10,
        },
        marker,
      );
      const row = await prisma.email.findFirstOrThrow({
        where: { batchId: result.batchId },
      });
      // Test-only one attempt makes the invalid credential a bounded failure without SMTP traffic.
      await (await emailQueue.getJob(row.bullJobId))!.remove();
      await emailQueue.add(
        "send",
        { emailId: row.id },
        {
          jobId: row.bullJobId,
          delay: Math.max(0, due - Date.now()),
          attempts: 1,
        },
      );
      await stop(worker);
      worker = undefined;
      await stop(api);
      api = undefined;
      assert.equal(
        await (await emailQueue.getJob(row.bullJobId))!.getState(),
        "delayed",
      );
      api = start("server");
      worker = start("worker");
      await ready();
      await until(
        async () =>
          (await prisma.email.findUniqueOrThrow({ where: { id: row.id } }))
            .status === "FAILED",
      );
      const failed = await prisma.email.findUniqueOrThrow({
        where: { id: row.id },
      });
      assert.equal(failed.attempts, 1);
      assert.ok(failed.updatedAt.getTime() >= due);
      assert.match(failed.errorMessage ?? "", /encrypted secret/);
      await stop(worker);
      worker = undefined;
      await stop(api);
      api = undefined;
      api = start("server");
      worker = start("worker");
      await ready();
      assert.equal(
        (await prisma.email.findUniqueOrThrow({ where: { id: row.id } }))
          .attempts,
        1,
      );
      assert.equal(
        await (await emailQueue.getJob(row.bullJobId))!.getState(),
        "failed",
      );
    } finally {
      await stop(worker);
      await stop(api);
      const rows = await prisma.email.findMany({ where: { userId: user.id } });
      for (const row of rows)
        await (await emailQueue.getJob(row.bullJobId))?.remove();
      for (const job of await indexQueue.getJobs([
        "waiting",
        "delayed",
        "completed",
        "failed",
      ]))
        if (rows.some((row) => row.id === job.data.emailId)) await job.remove();
      await prisma.email.deleteMany({ where: { userId: user.id } });
      await prisma.scheduleBatch.deleteMany({ where: { userId: user.id } });
      await prisma.sender.delete({ where: { id: sender.id } });
      await prisma.user.delete({ where: { id: user.id } });
      await closeQueues();
      await redis.quit();
      await prisma.$disconnect();
    }
  },
);
