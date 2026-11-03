import { Client, errors } from "@elastic/elasticsearch";
import type { EmailStatus } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../config/db.js";
import { emailSelect } from "../../services/email-select.js";

export const searchClient = new Client({
  node: env.ELASTICSEARCH_URL,
  requestTimeout: 10000,
  maxRetries: 2,
});
export const EMAIL_INDEX = "reachinbox-emails-v1";
export async function ensureIndex() {
  try {
    await searchClient.indices.create({
      index: EMAIL_INDEX,
      mappings: {
        dynamic: "strict",
        properties: {
          emailId: { type: "keyword" },
          userId: { type: "keyword" },
          senderEmail: { type: "text", fields: { raw: { type: "keyword" } } },
          recipient: { type: "text", fields: { raw: { type: "keyword" } } },
          subject: { type: "text" },
          body: { type: "text" },
          status: { type: "keyword" },
          starred: { type: "boolean" },
          archived: { type: "boolean" },
          trashed: { type: "boolean" },
          scheduledAt: { type: "date" },
          sentAt: { type: "date" },
        },
      },
    });
  } catch (error) {
    if (!(
      error instanceof errors.ResponseError &&
      (error.meta.body as { error?: { type?: string } } | undefined)?.error
        ?.type === "resource_already_exists_exception"
    ))
      throw error;
  }
  await searchClient.indices.putMapping({
    index: EMAIL_INDEX,
    properties: {
      starred: { type: "boolean" },
      archived: { type: "boolean" },
      trashed: { type: "boolean" },
    },
  });
}
export async function indexEmail(emailId: string) {
  const email = await prisma.email.findUnique({
    where: { id: emailId },
    include: { sender: { select: { email: true } } },
  });
  if (!email || !email.indexDirty) return;
  await ensureIndex();
  try {
    await searchClient.index({
      index: EMAIL_INDEX,
      id: email.id,
      version: email.searchVersion,
      version_type: "external_gte",
      document: {
        emailId: email.id,
        userId: email.userId,
        senderEmail: email.sender.email,
        recipient: email.recipient,
        subject: email.subject,
        body: email.body,
        status: email.status,
        starred: email.starred,
        archived: email.archived,
        trashed: !!email.trashedAt,
        scheduledAt: email.scheduledAt.toISOString(),
        sentAt: email.sentAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    if (!(error instanceof errors.ResponseError && error.statusCode === 409))
      throw error;
  }
  await prisma.email.updateMany({
    where: { id: email.id, searchVersion: email.searchVersion },
    data: { indexDirty: false },
  });
}
export async function searchEmails(
  userId: string,
  query: {
    q?: string;
    status?: EmailStatus;
    page: number;
    pageSize: number;
    folder?: "scheduled" | "sent" | "starred" | "archive" | "trash";
  },
) {
  if (query.page * query.pageSize > 10000)
    throw Object.assign(
      new Error("Search supports the first 10,000 results. Narrow your query."),
      { statusCode: 400 },
    );
  const folder = query.folder;
  const folderWhere =
    folder === "trash"
      ? { trashedAt: { not: null } }
      : {
          trashedAt: null,
          ...(folder === "archive"
            ? { archived: true }
            : folder === "starred"
              ? { starred: true }
              : { archived: false }),
          ...(folder === "scheduled" || folder === "sent"
            ? {
                status: {
                  in: (folder === "scheduled"
                    ? ["SCHEDULED", "PROCESSING"]
                    : ["SENT", "FAILED"]) as EmailStatus[],
                },
              }
            : {}),
        };
  const filters: object[] = [
    { term: { trashed: folder === "trash" } },
    ...(folder === "archive"
      ? [{ term: { archived: true } }]
      : folder === "starred"
        ? [{ term: { starred: true } }]
        : folder === "trash"
          ? []
          : [{ term: { archived: false } }]),
    ...(folder === "scheduled"
      ? [{ terms: { status: ["SCHEDULED", "PROCESSING"] } }]
      : folder === "sent"
        ? [{ terms: { status: ["SENT", "FAILED"] } }]
        : []),
    { term: { userId } },
    ...(query.status ? [{ term: { status: query.status } }] : []),
  ];
  try {
    const response = await searchClient.search<{ emailId: string }>({
      index: EMAIL_INDEX,
      from: (query.page - 1) * query.pageSize,
      size: query.pageSize,
      track_total_hits: true,
      query: {
        bool: {
          filter: filters,
          must: query.q
            ? [
                {
                  bool: {
                    minimum_should_match: 1,
                    should: [
                      {
                        multi_match: {
                          query: query.q,
                          fields: ["subject^2", "body"],
                          type: "bool_prefix",
                          operator: "and",
                        },
                      },
                      // The standard analyzer can keep an email address as one
                      // token. Search its existing keyword field for fragments
                      // too; escape user input so * and ? remain literal text.
                      ...["recipient.raw", "senderEmail.raw"].map((field) => ({
                        wildcard: {
                          [field]: {
                            value: `*${query.q!.replace(/[\\*?]/g, "\\$&")}*`,
                            case_insensitive: true,
                          },
                        },
                      })),
                    ],
                  },
                },
              ]
            : [{ match_all: {} }],
        },
      },
      sort: [{ scheduledAt: "desc" }, { emailId: "asc" }],
    });
    const ids = response.hits.hits.map((hit) => hit._id!).filter(Boolean);
    // Ownership is checked again against the source of truth, even if the search index is stale.
    const records = await prisma.email.findMany({
      where: {
        ...folderWhere,
        id: { in: ids },
        userId,
        ...(query.status ? { status: query.status } : {}),
      },
      select: emailSelect,
    });
    const map = new Map(records.map((email) => [email.id, email]));
    const total =
      typeof response.hits.total === "number"
        ? response.hits.total
        : (response.hits.total?.value ?? 0);
    return {
      items: ids.flatMap((id) => (map.has(id) ? [map.get(id)!] : [])),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  } catch (error) {
    if (error instanceof errors.ResponseError && error.statusCode === 404)
      return {
        items: [],
        total: 0,
        page: query.page,
        pageSize: query.pageSize,
      };
    throw Object.assign(
      new Error(
        "Search is temporarily unavailable. Email records are safe; try again shortly.",
      ),
      { statusCode: 503, cause: error },
    );
  }
}
