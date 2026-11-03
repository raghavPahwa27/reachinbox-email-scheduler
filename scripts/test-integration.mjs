import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const external = process.argv.includes("--external");
const database = external
  ? process.env.DATABASE_TEST_URL
  : "postgresql://reachinbox_test:isolated_test_password@127.0.0.1:15432/reachinbox_test";
const redisPort = external ? process.env.REDIS_TEST_PORT : "16379";
const elasticsearch = external
  ? process.env.ELASTICSEARCH_TEST_URL
  : "http://127.0.0.1:19200";
if (!database || !redisPort || !elasticsearch)
  throw new Error(
    "External mode requires DATABASE_TEST_URL, REDIS_TEST_PORT and ELASTICSEARCH_TEST_URL.",
  );
if (!new URL(database).pathname.endsWith("_test"))
  throw new Error(
    "Integration database name must end with _test. Never use the application database.",
  );
const env = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: database,
  DATABASE_TEST_URL: database,
  TEST_DATABASE_URL: database,
  REDIS_HOST: "127.0.0.1",
  REDIS_PORT: redisPort,
  REDIS_TEST_PORT: redisPort,
  TEST_REDIS_PORT: redisPort,
  ELASTICSEARCH_URL: elasticsearch,
  ELASTICSEARCH_TEST_URL: elasticsearch,
  JWT_SECRET: randomBytes(48).toString("base64"),
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  SLACK_CLIENT_ID: "",
  SLACK_CLIENT_SECRET: "",
  ETHEREAL_USER: "",
  ETHEREAL_PASS: "",
};
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} failed (${signal || code}).`)),
    );
  });
}
const compose = ["compose", "-f", "docker-compose.test.yml"];
try {
  if (!external)
    await run("docker", [
      ...compose,
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      "300",
    ]);
  await run(process.execPath, [
    "node_modules/prisma/build/index.js",
    "migrate",
    "deploy",
    "--schema",
    "backend/prisma/schema.prisma",
  ]);
  const backend = (await readdir(new URL("../backend/test/", import.meta.url)))
    .filter((name) => name.endsWith(".test.ts"))
    .map((name) => `backend/test/${name}`);
  const frontend = (
    await readdir(new URL("../frontend/src/utils/", import.meta.url))
  )
    .filter((name) => name.endsWith(".test.ts"))
    .map((name) => `frontend/src/utils/${name}`);
  await run(process.execPath, [
    "--import",
    "tsx",
    "--test",
    "--test-concurrency=1",
    ...backend,
    ...frontend,
  ]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (!external)
    await run("docker", [...compose, "down"]).catch((error) =>
      console.error(error.message),
    );
}
