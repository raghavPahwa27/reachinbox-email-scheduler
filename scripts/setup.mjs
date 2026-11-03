import { randomBytes } from "node:crypto";
import { readFile, writeFile, copyFile, constants } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const backend = new URL("backend/.env", root);
try {
  let template = await readFile(new URL("backend/.env.example", root), "utf8");
  template = template
    .replace(
      /^JWT_SECRET=$/m,
      `JWT_SECRET=${randomBytes(48).toString("base64")}`,
    )
    .replace(
      /^ENCRYPTION_KEY=$/m,
      `ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`,
    );
  await writeFile(backend, template, { flag: "wx", mode: 0o600 });
  console.log(
    "Created backend/.env with independent random session and encryption secrets.",
  );
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log(
    "Kept existing backend/.env, including its stable encryption key.",
  );
}
try {
  await copyFile(
    new URL("frontend/.env.example", root),
    new URL("frontend/.env", root),
    constants.COPYFILE_EXCL,
  );
  console.log("Created frontend/.env.");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log("Kept existing frontend/.env.");
}
console.log(
  `Configure Google, Slack and Ethereal in ${fileURLToPath(backend)}. Secret values are never printed.`,
);
console.log(
  "Next: npm run doctor, docker compose up -d --wait, npm run db:generate, npm run db:migrate.",
);
