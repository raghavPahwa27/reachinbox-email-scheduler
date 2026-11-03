import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import type { FormEvent } from "react";
import {
  AlertCircle,
  ArrowLeft,
  LoaderCircle,
  Mail,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Modal } from "./Modal";
import { api, errorMessage } from "../services/api";
import type { Sender } from "../types";
interface SenderDraft {
  name: string;
  email: string;
  smtpUser: string;
  smtpPassword: string;
  hourlyLimit: number;
  minDelaySeconds: number;
}
const empty: SenderDraft = {
  name: "",
  email: "",
  smtpUser: "",
  smtpPassword: "",
  hourlyLimit: 200,
  minDelaySeconds: 2,
};
export function SendersModal({
  senders,
  onClose,
  onChange,
}: {
  senders: Sender[];
  onClose: () => void;
  onChange: () => Promise<void>;
}) {
  const { session } = useAuth();
  const initialDraft = {
    ...empty,
    hourlyLimit: session!.senderDefaults.hourlyLimit,
    minDelaySeconds: session!.senderDefaults.minDelaySeconds,
  };
  const [editing, setEditing] = useState<Sender | "new" | null>(
    senders.length ? null : "new",
  );
  const [draft, setDraft] = useState<SenderDraft>(initialDraft);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const edit = (sender: Sender) => {
    setEditing(sender);
    setError("");
    setDraft({
      name: sender.name,
      email: sender.email,
      smtpUser: "",
      smtpPassword: "",
      hourlyLimit: sender.hourlyLimit,
      minDelaySeconds: sender.minDelaySeconds,
    });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const payload = {
        ...draft,
        smtpUser: draft.smtpUser || undefined,
        smtpPassword: draft.smtpPassword || undefined,
      };
      await api(
        editing === "new" ? "/senders" : `/senders/${(editing as Sender).id}`,
        {
          method: editing === "new" ? "POST" : "PATCH",
          body: JSON.stringify(payload),
        },
      );
      await onChange();
      setEditing(null);
      setDraft(initialDraft);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      await api(`/senders/${id}`, { method: "DELETE" });
      await onChange();
      setDeleting(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const field = (key: keyof SenderDraft, value: string | number) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  return (
    <Modal
      title={
        editing
          ? editing === "new"
            ? "Add a sender"
            : "Edit sender"
          : "Your senders"
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="modal-content">
        {error && (
          <div className="notice error" role="alert">
            <AlertCircle size={18} />
            {error}
          </div>
        )}
        {editing ? (
          <form onSubmit={(e) => void submit(e)}>
            <p className="muted modal-description">
              Connect an Ethereal account to send and preview test emails.
            </p>
            <div className="two-columns">
              <label className="field">
                Sender name
                <input
                  required
                  maxLength={100}
                  value={draft.name}
                  onChange={(e) => field("name", e.target.value)}
                  placeholder="Alex from ReachInbox"
                />
              </label>
              <label className="field">
                From email
                <input
                  required
                  type="email"
                  value={draft.email}
                  onChange={(e) => field("email", e.target.value)}
                  placeholder="alex@ethereal.email"
                />
              </label>
            </div>
            <label className="field">
              Ethereal SMTP username
              <input
                autoComplete="off"
                value={draft.smtpUser}
                onChange={(e) => field("smtpUser", e.target.value)}
                placeholder={
                  editing === "new"
                    ? "Use server default if blank"
                    : "Keep current credentials if blank"
                }
              />
            </label>
            <label className="field">
              Ethereal SMTP password
              <input
                type="password"
                autoComplete="new-password"
                value={draft.smtpPassword}
                onChange={(e) => field("smtpPassword", e.target.value)}
                placeholder={
                  editing === "new"
                    ? "Use server default if blank"
                    : "Keep current password if blank"
                }
              />
              <span className="field-hint">
                SMTP credentials are encrypted before they are stored.
              </span>
            </label>
            <div className="two-columns">
              <label className="field">
                Hourly limit
                <input
                  required
                  type="number"
                  min={1}
                  step={1}
                  value={draft.hourlyLimit}
                  onChange={(e) => field("hourlyLimit", Number(e.target.value))}
                />
              </label>
              <label className="field">
                Minimum delay (seconds)
                <input
                  required
                  type="number"
                  min={0}
                  max={86400}
                  step={1}
                  value={draft.minDelaySeconds}
                  onChange={(e) =>
                    field("minDelaySeconds", Number(e.target.value))
                  }
                />
              </label>
            </div>
            <div className="inline-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                <ArrowLeft size={16} />
                Back
              </button>
              <button className="button primary" disabled={busy}>
                {busy && <LoaderCircle className="spin" size={16} />}Save sender
              </button>
            </div>
          </form>
        ) : (
          <>
            <p className="muted modal-description">
              Each sender has its own credentials and sending pace.
            </p>
            <div className="sender-list">
              {senders.map((sender) => (
                <div className="sender-card" key={sender.id}>
                  <span className="sender-icon">
                    <Mail size={18} />
                  </span>
                  <div className="sender-info">
                    <strong>{sender.name}</strong>
                    <span>{sender.email}</span>
                    <small>
                      {sender.hourlyLimit} emails/hour ·{" "}
                      {sender.minDelaySeconds}s minimum delay
                    </small>
                    {deleting === sender.id && (
                      <div className="delete-confirm">
                        <span>
                          Remove this sender? Senders with email history cannot
                          be deleted.
                        </span>
                        <button
                          className="text-button danger"
                          disabled={busy}
                          onClick={() => void remove(sender.id)}
                        >
                          Confirm removal
                        </button>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => setDeleting(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    className="icon-button"
                    aria-label={`Edit ${sender.name}`}
                    onClick={() => edit(sender)}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-button danger"
                    aria-label={`Delete ${sender.name}`}
                    onClick={() => setDeleting(sender.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            <button
              className="button secondary add-sender"
              onClick={() => {
                setEditing("new");
                setDraft(initialDraft);
                setError("");
              }}
            >
              <Plus size={16} />
              Add sender
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
