export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
}
export interface Session {
  user: User;
  isAdmin: boolean;
  hasPassword: boolean;
  csrfToken: string;
  senderDefaults: {
    hourlyLimit: number;
    minDelaySeconds: number;
    maxHourlyLimit: number;
  };
}
export interface Sender {
  id: string;
  email: string;
  name: string;
  hourlyLimit: number;
  minDelaySeconds: number;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
}
export type EmailStatus = "SCHEDULED" | "PROCESSING" | "SENT" | "FAILED";
export interface Email {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  starred: boolean;
  archived: boolean;
  trashedAt: string | null;
  batch: { attachments: Attachment[] };
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  originalScheduledAt?: string;
  errorMessage: string | null;
  previewUrl?: string | null;
  sender: { email: string; name: string };
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface SlackStatus {
  connected: boolean;
  teamName?: string;
  channelId?: string;
}
export interface ScheduleInput {
  senderId: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  attachments?: AttachmentInput[];
  recipients: string[];
  startTime: string;
  delaySeconds: number;
  hourlyLimit: number;
}
export interface ScheduleResult {
  batchId: string;
  count: number;
  replayed: boolean;
  queuePending?: boolean;
}

export interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}
export interface AttachmentInput {
  filename: string;
  contentType: string;
  content: string;
}
export type Mailbox = "scheduled" | "sent" | "starred" | "archive" | "trash";
