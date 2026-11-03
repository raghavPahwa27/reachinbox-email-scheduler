import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";

const root = new URL("../", import.meta.url);
let config = {};
try {
  config = dotenv.parse(await readFile(new URL("backend/.env", root)));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const env = { ...config, ...process.env };
let missing = false;
function check(label, ok, instruction) {
  console.log(
    `${ok ? "OK" : "MISSING"} ${label}${ok ? "" : `: ${instruction}`}`,
  );
  missing ||= !ok;
}
const [major, minor] = process.versions.node.split(".").map(Number);
check(
  "Node.js",
  major > 22 || (major === 22 && minor >= 12),
  "Install Node.js 22.12 or newer.",
);
check("Session secret", env.JWT_SECRET?.length >= 32, "Run npm run setup.");
check(
  "Encryption key",
  Boolean(
    env.ENCRYPTION_KEY &&
    Buffer.from(env.ENCRYPTION_KEY, "base64").length === 32,
  ),
  "Run npm run setup; preserve existing encryption keys.",
);
check(
  "PostgreSQL configuration",
  Boolean(env.DATABASE_URL),
  "Set DATABASE_URL in backend/.env.",
);
for (const [label, names] of [
  [
    "Google OAuth",
    ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_CALLBACK_URL"],
  ],
  [
    "Slack OAuth",
    ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_REDIRECT_URI"],
  ],
])
  check(
    label,
    names.every((name) => Boolean(env[name]?.trim())),
    `Set ${names.join(", ")} in backend/.env.`,
  );
console.log(
  env.ETHEREAL_USER && env.ETHEREAL_PASS
    ? "OK Default Ethereal account configured"
    : "INFO Add Ethereal credentials in backend/.env or in Sending accounts after login.",
);
const docker = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
  stdio: "ignore",
  timeout: 10000,
  windowsHide: true,
});
console.log(
  docker.status === 0
    ? "OK Docker engine available"
    : "INFO Docker engine unavailable; start Docker Desktop or provide PostgreSQL, Redis and Elasticsearch yourself.",
);
for (const [label, url] of [
  ["API", `http://localhost:${env.PORT || 3001}/health/ready`],
  ["Elasticsearch", env.ELASTICSEARCH_URL || "http://localhost:9200"],
]) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    console.log(
      `${response.ok ? "OK" : "INFO"} ${label}: HTTP ${response.status}`,
    );
  } catch {
    console.log(`INFO ${label} is not reachable yet.`);
  }
}
console.log(
  "No secret values were displayed. See README.md for callback registration and startup.",
);
process.exitCode = missing ? 1 : 0;
