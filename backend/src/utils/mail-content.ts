import sanitizeHtml from "sanitize-html";
import { z } from "zod";

export const cleanMailHtml = (html: string) =>
  sanitizeHtml(html, {
    allowedTags: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "strike",
      "h1",
      "h2",
      "h3",
      "ul",
      "ol",
      "li",
      "blockquote",
      "a",
      "hr",
    ],
    allowedAttributes: { a: ["href", "title"], "*": ["style"] },
    allowedSchemes: ["https", "http", "mailto"],
    allowedStyles: { "*": { "text-align": [/^(left|right|center|justify)$/] } },
  });
export const attachmentInput = z
  .object({
    filename: z
      .string()
      .min(1)
      .max(200)
      .refine((v) => !/[\r\n\x00/\\]/.test(v), "Invalid filename"),
    contentType: z.enum([
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "application/pdf",
      "text/plain",
      "text/csv",
    ]),
    content: z
      .string()
      .max(7_000_000)
      .refine(
        (v) =>
          /^[A-Za-z0-9+/]*={0,2}$/.test(v) &&
          Buffer.from(v, "base64").toString("base64") === v,
        "Invalid attachment encoding",
      ),
  })
  .refine((v) => {
    const n = Buffer.from(v.content, "base64").length;
    return n > 0 && n <= 5 * 1024 * 1024;
  }, "Each attachment must be between 1 byte and 5 MB");
