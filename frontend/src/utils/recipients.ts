export interface RecipientResult {
  emails: string[];
  invalid: string[];
  duplicates: number;
}
const emailPattern =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
export function isEmail(value: string): boolean {
  const local = value.split("@")[0];
  return (
    value.length <= 254 &&
    local.length <= 64 &&
    !local.startsWith(".") &&
    !local.endsWith(".") &&
    !local.includes("..") &&
    emailPattern.test(value)
  );
}
/** Small RFC4180-style tokenizer: quoted cells, escaped quotes and multiline values. */
export function parseCells(text: string): string[] {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && /[,;\r\n\t]/.test(c)) {
      cells.push(value.trim());
      value = "";
    } else value += c;
  }
  if (quoted)
    throw new Error(
      "The file contains an unclosed quoted field. Please check its CSV format.",
    );
  cells.push(value.trim());
  return cells.filter(Boolean);
}
export function parseRecipients(text: string): RecipientResult {
  const unique = new Set<string>();
  const invalid = new Set<string>();
  let duplicates = 0;
  for (const cell of parseCells(text.replace(/^\uFEFF/, ""))) {
    // Ignore names and header columns. Report malformed cells that look like addresses.
    const parts = cell.match(/[^\s<>]+@[^\s<>]+/g) ?? [];
    for (const part of parts) {
      const email = part.trim().toLowerCase();
      if (!isEmail(email)) invalid.add(email);
      else if (unique.has(email)) duplicates++;
      else unique.add(email);
    }
  }
  return { emails: [...unique], invalid: [...invalid], duplicates };
}
export async function readRecipientFile(file: File): Promise<RecipientResult> {
  if (!/\.(csv|txt)$/i.test(file.name))
    throw new Error("Choose a .csv or .txt file.");
  if (file.size > 2 * 1024 * 1024)
    throw new Error("File is too large. The maximum size is 2 MB.");
  const result = parseRecipients(await file.text());
  if (!result.emails.length)
    throw new Error("No valid email addresses were found in this file.");
  return result;
}
