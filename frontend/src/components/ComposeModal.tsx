import { useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Clock3,
  FileText,
  LoaderCircle,
  Paperclip,
  Upload,
  X,
} from "lucide-react";
import { api, errorMessage } from "../services/api";
import { parseRecipients, readRecipientFile } from "../utils/recipients";
import type { RecipientResult } from "../utils/recipients";
import type {
  AttachmentInput,
  ScheduleInput,
  ScheduleResult,
  Sender,
} from "../types";
import { RichEditor } from "./RichEditor";
const localDate = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
const fileTypes = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
];
export function ComposeModal({
  senders,
  onClose,
  onSuccess,
}: {
  senders: Sender[];
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const [senderId, setSenderId] = useState(senders[0]?.id ?? "");
  const sender = senders.find((s) => s.id === senderId);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [recipientText, setRecipientText] = useState("");
  const [editingRecipients, setEditingRecipients] = useState(false);
  const [recipients, setRecipients] = useState<RecipientResult>({
    emails: [],
    invalid: [],
    duplicates: 0,
  });
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [startTime, setStartTime] = useState(
    localDate(new Date(Date.now() + 5 * 60000)),
  );
  const [scheduledTime, setScheduledTime] = useState("");
  const [picker, setPicker] = useState(false);
  const [delaySeconds, setDelaySeconds] = useState(
    sender?.minDelaySeconds ?? 2,
  );
  const [hourlyLimit, setHourlyLimit] = useState(sender?.hourlyLimit ?? 200);
  const [attachments, setAttachments] = useState<AttachmentInput[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const lastRequest = useRef<{
    fingerprint: string;
    key: string;
    startTime: string;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const changeRecipients = (text: string) => {
    setRecipientText(text);
    setFileName("");
    try {
      setRecipients(parseRecipients(text));
      setParseError("");
    } catch (e) {
      setParseError(errorMessage(e));
      setRecipients({ emails: [], invalid: [], duplicates: 0 });
    }
  };
  const uploadList = async (file?: File) => {
    if (!file) return;
    try {
      const result = await readRecipientFile(file);
      setRecipients(result);
      setRecipientText(result.emails.join(", "));
      setFileName(file.name);
      setParseError("");
      setEditingRecipients(false);
    } catch (e) {
      setParseError(errorMessage(e));
    }
  };
  const addAttachments = async (files: FileList | null) => {
    if (!files) return;
    setError("");
    setUploading(true);
    try {
      const incoming = [...files];
      if (incoming.length + attachments.length > 5)
        throw new Error("Attach at most 5 files.");
      if (
        incoming.some(
          (f) =>
            !fileTypes.includes(f.type) || !f.size || f.size > 5 * 1024 * 1024,
        )
      )
        throw new Error("Use images, PDF, CSV or TXT files up to 5 MB each.");
      if (
        incoming.reduce((n, f) => n + f.size, 0) +
          attachments.reduce((n, f) => n + atob(f.content).length, 0) >
        10 * 1024 * 1024
      )
        throw new Error("Attachments must total at most 10 MB.");
      const added = await Promise.all(
        incoming.map(
          (file) =>
            new Promise<AttachmentInput>((resolve, reject) => {
              const reader = new FileReader();
              reader.onerror = () =>
                reject(new Error("Could not read attachment."));
              reader.onload = () =>
                resolve({
                  filename: file.name,
                  contentType: file.type,
                  content: String(reader.result).split(",")[1],
                });
              reader.readAsDataURL(file);
            }),
        ),
      );
      setAttachments((v) => [...v, ...added]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };
  const submit = async () => {
    setError("");
    if (!recipients.emails.length || !subject.trim() || !body.trim()) {
      setError("Add a recipient, subject and message before sending.");
      return;
    }
    if (recipients.emails.length > 10000) {
      setError("Schedule at most 10,000 recipients at a time.");
      return;
    }
    const base = {
      senderId,
      subject: subject.trim(),
      body,
      bodyHtml,
      attachments,
      recipients: recipients.emails,
      delaySeconds,
      hourlyLimit,
    };
    const fingerprint = JSON.stringify({ ...base, scheduledTime });
    if (lastRequest.current?.fingerprint !== fingerprint)
      lastRequest.current = {
        fingerprint,
        key: crypto.randomUUID(),
        startTime: scheduledTime
          ? new Date(scheduledTime).toISOString()
          : new Date(Date.now() + 3000).toISOString(),
      };
    const payload: ScheduleInput = {
      ...base,
      startTime: lastRequest.current.startTime,
    };
    setBusy(true);
    try {
      const result = await api<ScheduleResult>("/emails/schedule", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Idempotency-Key": lastRequest.current.key },
      });
      onSuccess(
        `${result.count} ${result.count === 1 ? "email" : "emails"} ${result.replayed ? "already scheduled" : "scheduled"}.${result.queuePending ? " Saved safely; queue recovery is pending." : ""}`,
      );
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="compose-page">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <header className="message-header">
          <button
            type="button"
            className="back-title"
            onClick={onClose}
            disabled={busy}
          >
            <ArrowLeft size={21} />
            <h1>Compose New Email</h1>
          </button>
          <div className="message-actions">
            <button
              type="button"
              className={`icon-button ${attachments.length ? "green" : ""}`}
              aria-label="Attach files"
              title="Attach files"
              disabled={busy || uploading}
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip size={20} />
              {attachments.length > 0 && <sup>{attachments.length}</sup>}
            </button>
            <input
              ref={fileInput}
              className="sr-only"
              type="file"
              multiple
              accept={fileTypes.join(",")}
              onChange={(e) => {
                void addAttachments(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className={`icon-button ${scheduledTime ? "green" : ""}`}
              aria-label="Choose send time"
              title="Send later"
              aria-expanded={picker}
              onClick={() => setPicker((v) => !v)}
            >
              <Clock3 size={20} />
            </button>
            <button
              className="button outline send-button"
              disabled={busy || uploading || !!parseError}
            >
              {busy ? (
                <LoaderCircle size={15} className="spin" />
              ) : scheduledTime ? (
                "Send Later"
              ) : (
                "Send"
              )}
            </button>
          </div>
          {picker && (
            <div
              className="send-later-popover"
              role="dialog"
              aria-label="Send Later"
            >
              <h2>Send Later</h2>
              <label className="date-choice">
                <span>Pick date &amp; time</span>
                <input
                  aria-label="Start date and time"
                  type="datetime-local"
                  value={startTime}
                  min={localDate(new Date())}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </label>
              {[9, 10, 11, 15].map((hour, i) => (
                <button
                  key={hour}
                  type="button"
                  className="time-preset"
                  onClick={() => {
                    const d = new Date();
                    d.setDate(d.getDate() + 1);
                    d.setHours(hour, 0, 0, 0);
                    setStartTime(localDate(d));
                  }}
                >
                  {i === 0
                    ? "Tomorrow"
                    : `Tomorrow, ${hour > 12 ? hour - 12 : hour}:00 ${hour >= 12 ? "PM" : "AM"}`}
                </button>
              ))}
              <p className="picker-selection">
                {new Date(startTime).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                <br />
                {Intl.DateTimeFormat().resolvedOptions().timeZone}
              </p>
              <div className="popover-footer">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setScheduledTime("");
                    setPicker(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="button outline"
                  onClick={() => {
                    if (
                      !startTime ||
                      new Date(startTime).getTime() <= Date.now()
                    ) {
                      setError("Choose a start time in the future.");
                      return;
                    }
                    setScheduledTime(startTime);
                    setPicker(false);
                    setError("");
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </header>
        <div className="compose-body">
          {error && (
            <div className="notice error" role="alert">
              <AlertCircle size={16} />
              {error}
            </div>
          )}
          <label className="compose-line from-line">
            <span>From</span>
            <select
              aria-label="Sender"
              value={senderId}
              onChange={(e) => {
                const s = senders.find((s) => s.id === e.target.value)!;
                setSenderId(s.id);
                setDelaySeconds(s.minDelaySeconds);
                setHourlyLimit(s.hourlyLimit);
              }}
            >
              {senders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.email}
                </option>
              ))}
            </select>
          </label>
          <div className="compose-line">
            <label htmlFor="recipients">To</label>
            <div className="recipient-entry">
              {!editingRecipients && recipients.emails.length > 0 ? (
                <div
                  className="recipient-chips"
                  onClick={() => setEditingRecipients(true)}
                >
                  {recipients.emails.slice(0, 3).map((email) => (
                    <span key={email}>
                      {email}
                      <button
                        type="button"
                        aria-label={`Remove ${email}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          changeRecipients(
                            recipients.emails
                              .filter((v) => v !== email)
                              .join(", "),
                          );
                        }}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  {recipients.emails.length > 3 && (
                    <button
                      type="button"
                      className="more-recipients"
                      onClick={() => setEditingRecipients(true)}
                    >
                      +{recipients.emails.length - 3}
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-button"
                    aria-label="Edit recipients"
                    onClick={() => setEditingRecipients(true)}
                  >
                    Edit
                  </button>
                </div>
              ) : (
                <input
                  id="recipients"
                  aria-label="Recipients"
                  placeholder="recipient@example.com"
                  value={recipientText}
                  onFocus={() => setEditingRecipients(true)}
                  onBlur={() => setEditingRecipients(false)}
                  onChange={(e) => changeRecipients(e.target.value)}
                  autoFocus={editingRecipients}
                />
              )}
            </div>
            <label className="upload-link">
              <Upload size={14} />
              Upload List
              <input
                className="sr-only"
                type="file"
                accept=".csv,.txt"
                onChange={(e) => {
                  void uploadList(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {(recipients.emails.length > 0 ||
            parseError ||
            recipients.invalid.length > 0) && (
            <div className="recipient-feedback" role="status">
              {recipients.emails.length} valid recipients
              {fileName && ` · ${fileName}`}
              {recipients.duplicates > 0 &&
                ` · ${recipients.duplicates} duplicates removed`}
              {recipients.invalid.length > 0 && (
                <span className="field-error">
                  {" "}
                  · {recipients.invalid.length} invalid addresses excluded
                </span>
              )}
              {parseError && <span className="field-error">{parseError}</span>}
            </div>
          )}
          <label className="compose-line">
            <span>Subject</span>
            <input
              required
              maxLength={998}
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <div className="compose-limits">
            <label>
              Delay between 2 emails{" "}
              <input
                aria-label="Delay between emails in seconds"
                type="number"
                required
                min={sender?.minDelaySeconds ?? 2}
                max={86400}
                value={delaySeconds}
                onChange={(e) => setDelaySeconds(Number(e.target.value))}
              />
              <span className="sr-only">seconds</span>
            </label>
            <label>
              Hourly Limit{" "}
              <input
                type="number"
                required
                min={1}
                max={sender?.hourlyLimit ?? 200}
                value={hourlyLimit}
                onChange={(e) => setHourlyLimit(Number(e.target.value))}
              />
            </label>
            {scheduledTime && (
              <button
                type="button"
                className="scheduled-chip"
                onClick={() => setPicker(true)}
              >
                <Clock3 size={13} />
                {new Date(scheduledTime).toLocaleString()}
              </button>
            )}
          </div>
          <RichEditor
            onChange={(text, html) => {
              setBody(text);
              setBodyHtml(html);
            }}
          />
          <div className="attachment-list">
            {attachments.map((file, i) => (
              <div className="attachment-card" key={`${i}-${file.filename}`}>
                <button
                  type="button"
                  className="attachment-remove"
                  aria-label={`Remove ${file.filename}`}
                  onClick={() =>
                    setAttachments((v) => v.filter((_, n) => n !== i))
                  }
                >
                  <X size={13} />
                </button>
                {file.contentType.startsWith("image/") ? (
                  <img
                    src={`data:${file.contentType};base64,${file.content}`}
                    alt={file.filename}
                  />
                ) : (
                  <div className="file-icon">
                    <FileText size={28} />
                  </div>
                )}
                <strong>{file.filename}</strong>
                <small>
                  {(atob(file.content).length / 1024).toFixed(1)} KB
                </small>
              </div>
            ))}
          </div>
        </div>
      </form>
    </main>
  );
}
