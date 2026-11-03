import test from "node:test";
import assert from "node:assert/strict";
import { scheduleSchema, scheduleTimes } from "../src/validators/schedule.js";

const input = {
  senderId: "08e8e102-1f49-43c1-8326-9f1c218a251b",
  subject: "Hello",
  body: "Test",
  recipients: ["a@example.com"],
  startTime: "2026-12-01T10:00:00Z",
  delaySeconds: 5,
  hourlyLimit: 200,
};
test("three recipients preserve start time and five-second intervals", () => {
  assert.deepEqual(
    scheduleTimes(input.startTime, 3, 5).map((time) => time.toISOString()),
    [
      "2026-12-01T10:00:00.000Z",
      "2026-12-01T10:00:05.000Z",
      "2026-12-01T10:00:10.000Z",
    ],
  );
});
test("recipient normalization deduplicates addresses without reordering", () => {
  assert.deepEqual(
    scheduleSchema.parse({
      ...input,
      recipients: [" A@example.com ", "b@example.com", "a@example.com"],
    }).recipients,
    ["a@example.com", "b@example.com"],
  );
});
test("invalid recipients, empty batches, header injection and non-integer limits are rejected", () => {
  for (const replacement of [
    { recipients: ["wrong"] },
    { recipients: [] },
    { subject: "Hello\r\nBcc: someone@example.com" },
    { hourlyLimit: 1.5 },
    { delaySeconds: -1 },
    { senderId: "other-user-id" },
    { startTime: "not-a-date" },
  ]) {
    assert.equal(
      scheduleSchema.safeParse({ ...input, ...replacement }).success,
      false,
    );
  }
});
test("1000 scheduled recipients have exact offsets rather than simultaneous delivery", () => {
  const times = scheduleTimes(input.startTime, 1000, 2);
  assert.equal(times.length, 1000);
  assert.equal(times[999]!.getTime() - times[0]!.getTime(), 1998000);
});
