import assert from "node:assert/strict";
import test from "node:test";
import { isEmail, parseCells, parseRecipients } from "./recipients.ts";
test("extracts addresses from CSV headers and quoted names, deduplicates case-insensitively", () => {
  assert.deepEqual(
    parseRecipients(
      '\uFEFFName,Email\r\n"Jones, Alex",ALEX@example.com\r\nAlex,alex@example.com\n"Sam \"\"S\"\"",sam+test@example.org',
    ),
    {
      emails: ["alex@example.com", "sam+test@example.org"],
      invalid: [],
      duplicates: 1,
    },
  );
});
test("supports plain text, semicolons, tabs and display names", () => {
  assert.deepEqual(
    parseRecipients(
      "Alex <alex@example.com>;sam@example.org\tother@example.net",
    ).emails,
    ["alex@example.com", "sam@example.org", "other@example.net"],
  );
});
test("invalid email candidates are not silently treated as valid", () => {
  assert.deepEqual(
    parseRecipients("bad@example..com,valid@example.com,invalid@localhost")
      .invalid,
    ["bad@example..com", "invalid@localhost"],
  );
  assert.equal(isEmail("a@-example.com"), false);
  assert.equal(isEmail(".a@example.com"), false);
  assert.equal(isEmail("a..b@example.com"), false);
  assert.equal(isEmail("a".repeat(65) + "@example.com"), false);
});
test("empty and non-email CSV cells do not create recipients", () =>
  assert.deepEqual(parseRecipients("Name,Email\nSam,"), {
    emails: [],
    invalid: [],
    duplicates: 0,
  }));
test("malformed quoted CSV is rejected, multiline quoted cells supported", () => {
  assert.throws(() => parseCells('"unclosed'), /unclosed/);
  assert.deepEqual(parseCells('"line one\nline two",x@example.com'), [
    "line one\nline two",
    "x@example.com",
  ]);
});

test("file validation accepts text, rejects unsupported formats, empty files and oversized files", async () => {
  const { readRecipientFile } = await import("./recipients.ts");
  assert.deepEqual(
    (
      await readRecipientFile(
        new File(["a@example.com\nb@example.com"], "contacts.txt"),
      )
    ).emails,
    ["a@example.com", "b@example.com"],
  );
  await assert.rejects(
    () => readRecipientFile(new File(["a@example.com"], "contacts.xlsx")),
    /csv or .txt/,
  );
  await assert.rejects(
    () => readRecipientFile(new File(["name,email"], "empty.csv")),
    /No valid email/,
  );
  await assert.rejects(
    () =>
      readRecipientFile(
        new File(["a".repeat(2 * 1024 * 1024 + 1)], "large.txt"),
      ),
    /too large/,
  );
});
