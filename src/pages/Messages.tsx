import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../auth/AuthContext";
import { IconChat, IconCheck } from "../components/icons";
import { listMessages, sendMessage, markRead } from "../lib/messages";
import type { Message } from "../lib/messages";
import type { ApiError } from "../lib/api";

const POLL_MS = 4000;

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function Messages() {
  const { token, user } = useAuth();
  const myId = user?.id;
  const otherLabel = user?.role === "contractor" ? "Client" : "Contractor";

  const [msgs, setMsgs] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const load = useCallback(async () => {
    try {
      const list = await listMessages(token);
      setMsgs(list);
      setError(null);
      const hasUnread = list.some((m) => m.sender_id !== myId && !m.read_at);
      if (hasUnread && document.visibilityState === "visible") {
        markRead(token)
          .then(() => window.dispatchEvent(new Event("messages-read")))
          .catch(() => {});
      }
    } catch (e) {
      setError((e as ApiError)?.message ?? "Could not load messages");
    }
  }, [token, myId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Track whether the user is near the bottom so polling doesn't yank them
  // away from history they're reading.
  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [msgs.length, loading]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const created = await sendMessage(token, body);
      setDraft("");
      stickToBottom.current = true;
      setMsgs((prev) => [...prev, created]);
    } catch (err) {
      setError((err as ApiError)?.message ?? "Could not send message");
    } finally {
      setSending(false);
    }
  }

  return (
    <AppShell title="Conversations" titleIcon={<IconChat />} fill>
      <div className="chat">
        <div className="chat-head">
          <span className="side-avatar">{otherLabel[0]}</span>
          <div>
            <div className="chat-name">{otherLabel}</div>
            <div className="hint">Private thread — just you and the {otherLabel.toLowerCase()}</div>
          </div>
        </div>

        {error && <div className="error-banner" style={{ margin: "10px 14px 0" }}>{error}</div>}

        <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
          {loading ? (
            <div className="empty">Loading conversation…</div>
          ) : msgs.length === 0 ? (
            <div className="empty">
              <h3>No messages yet</h3>
              <p className="hint">Say hello — everything here stays between the two of you.</p>
            </div>
          ) : (
            msgs.map((m, i) => {
              const mine = m.sender_id === myId;
              const newDay =
                i === 0 ||
                new Date(m.created_at).toDateString() !== new Date(msgs[i - 1].created_at).toDateString();
              return (
                <div key={m.id}>
                  {newDay && <div className="chat-day"><span>{dayLabel(m.created_at)}</span></div>}
                  <div className={`msg ${mine ? "mine" : "theirs"}`}>
                    <div className="msg-bubble">
                      {m.body}
                      <span className="msg-meta">
                        {timeLabel(m.created_at)}
                        {mine && (
                          <span className={`ticks ${m.read_at ? "read" : ""}`} title={m.read_at ? "Read" : "Sent"}>
                            <IconCheck />
                            {m.read_at && <IconCheck />}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <form className="chat-compose" onSubmit={submit}>
          <textarea
            className="input chat-input"
            placeholder={`Message the ${otherLabel.toLowerCase()}…`}
            value={draft}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(e);
              }
            }}
            aria-label="Message"
          />
          <button className="btn btn-primary chat-send" type="submit" disabled={!draft.trim() || sending}>
            Send
          </button>
        </form>
      </div>
    </AppShell>
  );
}
