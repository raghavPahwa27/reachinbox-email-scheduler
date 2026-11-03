import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Modal } from "./Modal";
import { apiUrl } from "../services/api";
export function ConnectSlackModal({ onClose }: { onClose: () => void }) {
  const [channelId, setChannelId] = useState("");
  return (
    <Modal title="Connect Slack" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          window.location.assign(
            apiUrl(
              `/api/slack/connect?${new URLSearchParams({ channelId: channelId.trim() })}`,
            ),
          );
        }}
      >
        <div className="modal-content">
          <p className="muted">
            Choose where ReachInbox should post hourly-limit notifications.
          </p>
          <label className="field">
            Slack channel ID
            <input
              required
              autoFocus
              value={channelId}
              onChange={(event) => setChannelId(event.target.value)}
              pattern="[CG][A-Z0-9]{8,31}"
              placeholder="C0123456789"
              title="Copy the channel ID from Slack channel details; it starts with C or G."
            />
          </label>
          <p className="field-hint">
            In Slack, open your channel (for example #all-project), click its
            name, and copy the Channel ID from the details. After installing,
            invite the ReachInbox bot to that channel.
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            Continue to Slack
            <ArrowUpRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
