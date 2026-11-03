import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import DOMPurify from "dompurify";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  Filter,
  Inbox,
  KeyRound,
  LoaderCircle,
  LogOut,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Slack,
  Star,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, apiUrl, errorMessage } from "../services/api";
import { SendersModal } from "../components/SendersModal";
import { Modal } from "../components/Modal";
import { Brand } from "../components/Brand";
import { ConnectSlackModal } from "../components/ConnectSlackModal";
import { slackErrorMessage } from "../utils/slack-errors";
import type {
  Email,
  EmailStatus,
  Mailbox,
  Page,
  Sender,
  SlackStatus,
} from "../types";
const ComposeModal = lazy(() =>
  import("../components/ComposeModal").then((module) => ({
    default: module.ComposeModal,
  })),
);
const labels: Record<EmailStatus, string> = {
  SCHEDULED: "Scheduled",
  PROCESSING: "Processing",
  SENT: "Sent",
  FAILED: "Failed",
};
const folders: { id: Mailbox; label: string; icon: typeof Send }[] = [
  { id: "scheduled", label: "Scheduled", icon: Clock3 },
  { id: "sent", label: "Sent", icon: Send },
  { id: "starred", label: "Starred", icon: Star },
  { id: "archive", label: "Archive", icon: Archive },
  { id: "trash", label: "Trash", icon: Trash2 },
];
const date = (v: string | null) =>
  v
    ? new Date(v).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";
const shortDate = (v: string) =>
  new Date(v).toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
export function Dashboard() {
  const { session, logout, refresh } = useAuth();
  const [params, setParams] = useSearchParams();
  const [folder, setFolder] = useState<Mailbox>("scheduled");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [status, setStatus] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [emails, setEmails] = useState<Page<Email> | null>(null);
  const [counts, setCounts] = useState<Partial<Record<Mailbox, number>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [senders, setSenders] = useState<Sender[]>([]);
  const [slack, setSlack] = useState<SlackStatus | null>(null);
  const [compose, setCompose] = useState(false);
  const [manageSenders, setManageSenders] = useState(false);
  const [detail, setDetail] = useState<Email | null>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [revision, setRevision] = useState(0);
  const [accountOpen, setAccountOpen] = useState(false);
  const [connections, setConnections] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [connectSlack, setConnectSlack] = useState(false);
  const [disconnectConfirm, setDisconnectConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);
  const loadSenders = useCallback(async () => {
    try {
      setSenders(await api<Sender[]>("/senders"));
    } catch (e) {
      setActionError(errorMessage(e));
    }
  }, []);
  const loadSlack = useCallback(async () => {
    try {
      setSlack(await api<SlackStatus>("/slack/status"));
    } catch (e) {
      setActionError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void loadSenders();
    void loadSlack();
  }, [loadSenders, loadSlack]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (params.has("oauthError") || params.has("error")) {
      setActionError(slackErrorMessage(params.get("slackError")));
      setParams({}, { replace: true });
    } else if (params.has("slack")) {
      setNotice("Slack connected.");
      setParams({}, { replace: true });
      void loadSlack();
    }
  }, [params, setParams, loadSlack]);
  useEffect(() => {
    void api<Record<Mailbox, number>>("/emails/counts")
      .then(setCounts)
      .catch(() => {});
  }, [revision]);
  useEffect(() => {
    const id = ++requestId.current;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const search = new URLSearchParams({ page: String(page), pageSize: "20" });
    let path = `/emails/${folder}`;
    if (searchQuery || status) {
      path = "/emails/search";
      search.set("q", searchQuery);
      search.set("folder", folder);
      if (status) search.set("status", status);
    }
    api<Page<Email>>(`${path}?${search}`, { signal: controller.signal })
      .then((result) => {
        if (id === requestId.current) setEmails(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted && id === requestId.current)
          setError(errorMessage(e));
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
    return () => controller.abort();
  }, [folder, page, searchQuery, status, revision]);
  const changeFolder = (value: Mailbox) => {
    setFolder(value);
    setPage(1);
    setStatus("");
    setDetail(null);
    setAccountOpen(false);
  };
  const updateMail = async (
    email: Email,
    changes: { starred?: boolean; archived?: boolean; trashed?: boolean },
  ) => {
    setActionError("");
    try {
      const updated = await api<Email>(`/emails/${email.id}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
      setDetail((current) =>
        current?.id === updated.id
          ? changes.trashed || changes.archived
            ? null
            : updated
          : current,
      );
      setRevision((v) => v + 1);
      if (changes.trashed !== undefined)
        setNotice(
          changes.trashed
            ? "Moved to Trash. You can restore it from the account menu."
            : "Email restored.",
        );
      else if (changes.archived !== undefined)
        setNotice(
          changes.archived
            ? "Email archived."
            : "Email moved back to its mailbox.",
        );
    } catch (e) {
      setActionError(errorMessage(e));
    }
  };
  const disconnect = async () => {
    setBusy(true);
    try {
      await api("/slack/disconnect", { method: "POST" });
      await loadSlack();
      setDisconnectConfirm(false);
      setNotice("Slack disconnected.");
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (!session) return null;
  const avatar = session.user.avatar ? (
    <img
      className="avatar"
      src={session.user.avatar}
      alt=""
      referrerPolicy="no-referrer"
    />
  ) : (
    <span className="avatar avatar-fallback">
      {session.user.name.slice(0, 1)}
    </span>
  );
  if (compose)
    return (
      <Suspense
        fallback={
          <div className="page-loading" role="status">
            <LoaderCircle className="spin" size={24} />
            Opening composer…
          </div>
        }
      >
        <ComposeModal
          senders={senders}
          onClose={() => setCompose(false)}
          onSuccess={(message) => {
            setNotice(message);
            setRevision((v) => v + 1);
          }}
        />
      </Suspense>
    );
  const pages = Math.max(1, Math.ceil((emails?.total ?? 0) / 20));
  const notices = (
    <>
      {notice && (
        <div className="notice success" role="status">
          <CheckCircle2 size={16} />
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {actionError && (
        <div className="notice error" role="alert">
          <AlertCircle size={16} />
          <span>{actionError}</span>
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setActionError("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
  return (
    <div className={`app-shell ${detail ? "detail-open" : ""}`}>
      {!detail && (
        <aside className="sidebar">
          <Brand />
          <div className="account-wrap">
            <button
              className="account-button"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((v) => !v)}
            >
              {avatar}
              <span>
                <strong>{session.user.name}</strong>
                <small>{session.user.email}</small>
              </span>
              <ChevronDown size={15} />
            </button>
            {accountOpen && (
              <div className="account-menu">
                {folders.slice(2).map((f) => (
                  <button key={f.id} onClick={() => changeFolder(f.id)}>
                    <f.icon size={16} />
                    {f.label}
                    <span>{counts[f.id] ?? 0}</span>
                  </button>
                ))}
                <hr />
                <button
                  onClick={() => {
                    setManageSenders(true);
                    setAccountOpen(false);
                  }}
                >
                  <Settings2 size={16} />
                  Sending accounts
                </button>
                <button
                  onClick={() => {
                    setConnections(true);
                    setAccountOpen(false);
                  }}
                >
                  <Slack size={16} />
                  Slack integration
                </button>
                <button
                  onClick={() => {
                    setPasswordOpen(true);
                    setAccountOpen(false);
                  }}
                >
                  <KeyRound size={16} />
                  {session.hasPassword ? "Change password" : "Set password"}
                </button>
                {session.isAdmin && (
                  <a
                    href={apiUrl("/admin/queues")}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={16} />
                    Queue dashboard
                  </a>
                )}
                <hr />
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await logout();
                    } catch (e) {
                      setActionError(errorMessage(e));
                      setBusy(false);
                    }
                  }}
                >
                  <LogOut size={16} />
                  Log out
                </button>
              </div>
            )}
          </div>
          <button
            className="button outline sidebar-compose"
            onClick={() =>
              senders.length ? setCompose(true) : setManageSenders(true)
            }
          >
            Compose
          </button>
          <div className="nav-caption">CORE</div>
          <nav aria-label="Email lists">
            {folders
              .filter(
                (f) =>
                  f.id === "scheduled" || f.id === "sent" || f.id === folder,
              )
              .map((f) => (
                <button
                  key={f.id}
                  className={folder === f.id ? "active" : ""}
                  aria-current={folder === f.id ? "page" : undefined}
                  onClick={() => changeFolder(f.id)}
                >
                  <f.icon size={17} />
                  <span>{f.label}</span>
                  <small>{counts[f.id] ?? 0}</small>
                </button>
              ))}
          </nav>
          <div className="sidebar-bottom">
            <button onClick={() => setManageSenders(true)}>
              <Settings2 size={15} />
              Sending accounts <span>{senders.length}</span>
            </button>
            <button onClick={() => setConnections(true)}>
              <Slack size={15} />
              Slack{" "}
              <span className={slack?.connected ? "connection-dot" : ""}>
                {slack?.connected ? "Connected" : "Connect"}
              </span>
            </button>
          </div>
        </aside>
      )}
      {detail ? (
        <main className="message-page">
          <header className="message-header">
            <button className="back-title" onClick={() => setDetail(null)}>
              <ArrowLeft size={21} />
              <h1>{detail.subject}</h1>
            </button>
            <div className="message-actions">
              <button
                className={`icon-button ${detail.starred ? "is-starred" : ""}`}
                aria-label={detail.starred ? "Unstar email" : "Star email"}
                onClick={() =>
                  void updateMail(detail, { starred: !detail.starred })
                }
              >
                <Star
                  size={19}
                  fill={detail.starred ? "currentColor" : "none"}
                />
              </button>
              <button
                className="icon-button"
                aria-label={
                  detail.archived ? "Unarchive email" : "Archive email"
                }
                onClick={() =>
                  void updateMail(detail, { archived: !detail.archived })
                }
              >
                {detail.archived ? (
                  <ArchiveRestore size={19} />
                ) : (
                  <Archive size={19} />
                )}
              </button>
              <button
                className="icon-button"
                aria-label={
                  detail.trashedAt ? "Restore email" : "Move to Trash"
                }
                onClick={() =>
                  void updateMail(detail, { trashed: !detail.trashedAt })
                }
              >
                {detail.trashedAt ? <Undo2 size={19} /> : <Trash2 size={19} />}
              </button>
              {avatar}
            </div>
          </header>
          <div className="message-body">
            {notices}
            <div className="message-metadata">
              <span className="sender-avatar">
                {detail.sender.name.slice(0, 1)}
              </span>
              <div>
                <strong>{detail.sender.name}</strong>{" "}
                <span>&lt;{detail.sender.email}&gt;</span>
                <p>to {detail.recipient}</p>
              </div>
              <time>{date(detail.sentAt || detail.scheduledAt)}</time>
            </div>
            <div className="message-status">
              <span className={`status-badge ${detail.status.toLowerCase()}`}>
                {labels[detail.status]}
              </span>
              {!detail.sentAt && (
                <span>Scheduled for {date(detail.scheduledAt)}</span>
              )}
            </div>
            {detail.bodyHtml ? (
              <div
                className="message-copy"
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(detail.bodyHtml),
                }}
              />
            ) : (
              <div className="message-copy plain-text">{detail.body}</div>
            )}
            {detail.errorMessage && (
              <div className="notice error">{detail.errorMessage}</div>
            )}
            <div className="attachment-list">
              {detail.batch?.attachments.map((file) => (
                <a
                  className="attachment-card download-card"
                  key={file.id}
                  href={apiUrl(
                    `/api/emails/${detail.id}/attachments/${file.id}`,
                  )}
                  download
                >
                  <div className="file-icon">
                    <Download size={25} />
                  </div>
                  <strong>{file.filename}</strong>
                  <small>{(file.size / 1024).toFixed(1)} KB</small>
                </a>
              ))}
            </div>
            {detail.previewUrl &&
              /^https:\/\/ethereal\.email\//.test(detail.previewUrl) && (
                <a
                  className="preview-link"
                  href={detail.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Ethereal preview <ExternalLink size={14} />
                </a>
              )}
          </div>
        </main>
      ) : (
        <main className="mail-main">
          <div className="mail-toolbar">
            <div className="search-input">
              <Search size={16} />
              <input
                aria-label="Search emails"
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  className="icon-button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="filter-wrap">
              <button
                className={`icon-button ${status ? "green" : ""}`}
                aria-label="Filter by status"
                aria-expanded={filterOpen}
                onClick={() => setFilterOpen((v) => !v)}
              >
                <Filter size={17} />
              </button>
              {filterOpen && (
                <div className="filter-menu">
                  <label>
                    Status
                    <select
                      aria-label="Email status"
                      value={status}
                      onChange={(e) => {
                        setStatus(e.target.value);
                        setPage(1);
                        setFilterOpen(false);
                      }}
                    >
                      <option value="">All statuses</option>
                      {Object.entries(labels).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </div>
            <button
              className="icon-button"
              aria-label="Refresh emails"
              disabled={loading}
              onClick={() => setRevision((v) => v + 1)}
            >
              <RefreshCw size={17} className={loading ? "spin" : ""} />
            </button>
          </div>
          {notices}
          {(searchQuery || status) && (
            <div className="search-scope">
              {status ? `${labels[status as EmailStatus]} · ` : ""}
              {searchQuery
                ? `Results for “${searchQuery}”`
                : "Filtered emails"}{" "}
              in {folder}
            </div>
          )}
          {loading ? (
            <div className="table-state" role="status">
              <LoaderCircle size={23} className="spin" />
              <p>Loading emails…</p>
            </div>
          ) : error ? (
            <div className="table-state" role="alert">
              <AlertCircle size={26} />
              <h2>Unable to load emails</h2>
              <p>{error}</p>
              <button
                className="button outline"
                onClick={() => setRevision((v) => v + 1)}
              >
                Try again
              </button>
            </div>
          ) : !emails?.items.length ? (
            <div className="table-state">
              <Inbox size={30} />
              <h2>
                {query || status
                  ? "No matching emails"
                  : `No ${folder === "trash" ? "deleted" : folder === "archive" ? "archived" : folder} emails`}
              </h2>
              <p>
                {folder === "scheduled"
                  ? "Compose an email and choose when to send it."
                  : "Your messages will appear here."}
              </p>
            </div>
          ) : (
            <>
              <div
                className="mail-rows"
                role="list"
                aria-label={`${folder} emails`}
              >
                {emails.items.map((email) => (
                  <div className="mail-row" role="listitem" key={email.id}>
                    <button
                      className="mail-row-content"
                      onClick={() => setDetail(email)}
                    >
                      <span className="mail-recipient">
                        To: {email.recipient}
                      </span>
                      <span
                        className={`status-badge ${email.status.toLowerCase()}`}
                      >
                        {email.status === "SCHEDULED" ? (
                          <>
                            <Clock3 size={12} />
                            {shortDate(email.scheduledAt)}
                          </>
                        ) : (
                          labels[email.status]
                        )}
                      </span>
                      <span className="mail-subject">
                        {email.subject}
                        <span className="mail-snippet"> - {email.body}</span>
                      </span>
                      {(email.status === "SENT" ||
                        email.status === "FAILED") && (
                        <time>{date(email.sentAt || email.scheduledAt)}</time>
                      )}
                    </button>
                    <button
                      className={`icon-button star-button ${email.starred ? "is-starred" : ""}`}
                      aria-label={`${email.starred ? "Unstar" : "Star"} ${email.subject}`}
                      onClick={() =>
                        void updateMail(email, { starred: !email.starred })
                      }
                    >
                      <Star
                        size={16}
                        fill={email.starred ? "currentColor" : "none"}
                      />
                    </button>
                  </div>
                ))}
              </div>
              <div className="pagination">
                <span>{emails.total} emails</span>
                <div>
                  <button
                    className="icon-button"
                    aria-label="Previous page"
                    disabled={page === 1}
                    onClick={() => setPage((v) => v - 1)}
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <span>
                    {page} / {pages}
                  </span>
                  <button
                    className="icon-button"
                    aria-label="Next page"
                    disabled={page >= pages}
                    onClick={() => setPage((v) => v + 1)}
                  >
                    <ChevronRight size={17} />
                  </button>
                </div>
              </div>
            </>
          )}
        </main>
      )}
      {manageSenders && (
        <SendersModal
          senders={senders}
          onClose={() => setManageSenders(false)}
          onChange={loadSenders}
        />
      )}
      {connections && (
        <Modal
          title="Slack notifications"
          onClose={() => setConnections(false)}
        >
          <div className="modal-content">
            <p className="muted">
              Get notified when a sender reaches its hourly limit.
            </p>
            <div className="integration-card">
              <Slack size={28} />
              <div>
                <strong>{slack?.connected ? slack.teamName : "Slack"}</strong>
                <p>
                  {slack?.connected
                    ? `Connected · ${slack.channelId}`
                    : "No workspace connected"}
                </p>
              </div>
            </div>
            <button
              className="button outline"
              onClick={() => {
                setConnections(false);
                slack?.connected
                  ? setDisconnectConfirm(true)
                  : setConnectSlack(true);
              }}
            >
              {slack?.connected ? "Disconnect Slack" : "Connect Slack"}
            </button>
          </div>
        </Modal>
      )}
      {connectSlack && (
        <ConnectSlackModal onClose={() => setConnectSlack(false)} />
      )}
      {disconnectConfirm && (
        <Modal
          title="Disconnect Slack?"
          onClose={() => !busy && setDisconnectConfirm(false)}
        >
          <div className="modal-content">
            <p className="muted">
              Stop sending hourly limit notifications to {slack?.teamName}? You
              can reconnect at any time.
            </p>
            <div className="inline-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setDisconnectConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void disconnect()}
              >
                Disconnect
              </button>
            </div>
          </div>
        </Modal>
      )}
      {passwordOpen && (
        <Modal
          title={
            session.hasPassword ? "Change password" : "Enable password login"
          }
          onClose={() => {
            if (!busy) {
              setPasswordOpen(false);
              setPassword("");
              setCurrentPassword("");
            }
          }}
        >
          <form
            className="modal-content"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setActionError("");
              try {
                await api("/auth/password", {
                  method: "POST",
                  body: JSON.stringify({
                    password,
                    currentPassword: currentPassword || undefined,
                  }),
                });
                setPasswordOpen(false);
                setPassword("");
                setCurrentPassword("");
                setNotice(
                  "Password saved. You can now log in with your email and password.",
                );
                await refresh();
              } catch (e) {
                setActionError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <p className="muted modal-description">
              Use your verified Google account email, {session.user.email}, to
              sign in with a password.
            </p>
            {actionError && (
              <div className="notice error" role="alert">
                {actionError}
              </div>
            )}
            {session.hasPassword && (
              <label className="field">
                Current password
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </label>
            )}
            <label className="field">
              New password
              <input
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <small>At least 12 characters.</small>
            </label>
            <button className="button primary" disabled={busy}>
              Save password
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
