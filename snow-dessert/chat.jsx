// IceYoo Desaru — Agent chat panel
// Slide-up overlay that talks to the customer-facing agent at /api/chat/sync.
// Phase 1: sync (non-streaming). Phase 1+ upgrades to SSE streaming.

const { useState, useRef, useEffect } = React;

// ── config ────────────────────────────────────────────────────
const CHAT_API_URL = window.__CHAT_API_URL__ || "http://localhost:8002/api/chat/sync";
const RESTAURANT_NAME = "IceYoo Desaru";

// ── icons ─────────────────────────────────────────────────────
const IconChat = ({ size = 22, color = "#fff" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path
      d="M4 6a3 3 0 013-3h10a3 3 0 013 3v8a3 3 0 01-3 3H10l-4 3v-3H7a3 3 0 01-3-3V6z"
      fill={color}
    />
    <circle cx="9" cy="10" r="1.2" fill="#f47216" />
    <circle cx="12" cy="10" r="1.2" fill="#f47216" />
    <circle cx="15" cy="10" r="1.2" fill="#f47216" />
  </svg>
);

const IconClose = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M6 6l12 12M18 6L6 18" stroke="#111" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

const IconSend = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path
      d="M3 11.5L21 4l-7 17-3-8-8-1.5z"
      stroke="#fff"
      strokeWidth="2"
      strokeLinejoin="round"
      fill="#fff"
    />
  </svg>
);

const IconSpinner = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="9" stroke="#e0e0e0" strokeWidth="2.5" />
    <path
      d="M21 12a9 9 0 00-9-9"
      stroke="#f47216"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <animateTransform
        attributeName="transform"
        type="rotate"
        from="0 12 12"
        to="360 12 12"
        dur="0.9s"
        repeatCount="indefinite"
      />
    </path>
  </svg>
);

// ── chat bubble ───────────────────────────────────────────────
const ChatBubble = ({ role, text, tools, error }) => {
  const isUser = role === "user";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        marginBottom: 8,
      }}
    >
      <div
        style={{
          maxWidth: "78%",
          padding: "10px 14px",
          borderRadius: 18,
          borderBottomRightRadius: isUser ? 6 : 18,
          borderBottomLeftRadius: isUser ? 18 : 6,
          background: error ? "#fff1f0" : isUser ? "#f47216" : "#f1f1f0",
          color: error ? "#a02020" : isUser ? "#fff" : "#111",
          fontSize: 15,
          lineHeight: 1.4,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          border: error ? "1px solid #f5b5b0" : "none",
        }}
      >
        {text}
        {tools && tools.length > 0 && (
          <div
            style={{
              marginTop: 8,
              paddingTop: 6,
              borderTop: "1px solid rgba(0,0,0,0.08)",
              fontSize: 11,
              color: isUser ? "rgba(255,255,255,0.85)" : "#888",
            }}
          >
            {tools.map((t, i) => (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  marginRight: 6,
                  padding: "1px 7px",
                  borderRadius: 10,
                  background: isUser ? "rgba(255,255,255,0.18)" : "#fff",
                  border: isUser ? "none" : "1px solid #e0e0e0",
                }}
              >
                {t.replace(/^mcp__/, "").replace(/__/, ".")}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ── chat panel (slide up from bottom) ────────────────────────
function ChatPanel({ open, onClose }) {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text:
        "Hey! Welcome to " +
        RESTAURANT_NAME +
        ". I can help you order from our menu — Iceyoo, Bingsu, Korean chicken, or smoothies. What sounds good?",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState(
    () => window.localStorage.getItem("iceyoo_session_id") || null
  );
  // ── VIP demo toggle ────────────────────────────────────────
  // When ON, sends customer_id: "cust_sarah_001" so the agent loads
  // her profile from MemGC (after running scripts/seed-memgc-sarah.ts).
  // Defaults to ON so the demo opens with Sarah's profile pre-loaded.
  const [isVip, setIsVip] = useState(() => {
    const v = window.localStorage.getItem("iceyoo_is_vip");
    return v === null ? true : v === "1";
  });
  const customerId = isVip ? "cust_sarah_001" : null;
  const scrollerRef = useRef(null);
  const inputRef = useRef(null);

  // auto-scroll on new message
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // focus input on open
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current && inputRef.current.focus(), 200);
    }
  }, [open]);

  const send = async (overrideText) => {
    const text = (typeof overrideText === "string" ? overrideText : input).trim();
    if (!text || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    // Insert empty assistant message that gets filled by streaming deltas.
    setMessages((m) => [...m, { role: "assistant", text: "", streaming: true, tools: [] }]);
    setLoading(true);

    // Switch from /chat/sync to /chat (SSE). Same payload, streamed response.
    const STREAM_URL = CHAT_API_URL.replace(/\/sync$/, "");

    try {
      const res = await fetch(STREAM_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          message: text,
          session_id: sessionId,
          customer_id: customerId,
          channel: "mobile",
        }),
      });

      if (!res.ok || !res.body) {
        const errBody = await res.text().catch(() => "");
        setMessages((m) => {
          const next = [...m];
          next[next.length - 1] = {
            role: "assistant",
            error: true,
            text:
              "Sorry, the assistant is unreachable right now (HTTP " +
              res.status +
              "). " +
              "Make sure the backend is running: " +
              "`cd ai-feedme && make up && make dev`",
          };
          return next;
        });
        return;
      }

      // Read SSE stream: event lines like `event: chunk` followed by `data: {...}`.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "chunk";
      let finalData = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const lines = part.split("\n");
          for (const line of lines) {
            if (line.startsWith("event:")) currentEvent = line.slice(6).trim();
            else if (line.startsWith("data:")) {
              const raw = line.slice(5).trim();
              if (!raw) continue;
              try {
                const data = JSON.parse(raw);
                if (currentEvent === "chunk" && data.delta) {
                  setMessages((m) => {
                    const next = [...m];
                    const last = next[next.length - 1];
                    next[next.length - 1] = { ...last, text: (last.text || "") + data.delta };
                    return next;
                  });
                } else if (currentEvent === "done") {
                  finalData = data;
                } else if (currentEvent === "error") {
                  setMessages((m) => {
                    const next = [...m];
                    next[next.length - 1] = {
                      role: "assistant",
                      error: true,
                      text: "Agent error: " + (data.message || data.error || "unknown"),
                    };
                    return next;
                  });
                }
              } catch (e) {
                // ignore malformed SSE chunk
              }
            }
          }
        }
      }

      // Finalize: persist session id + tools metadata on the streamed message.
      if (finalData) {
        if (finalData.session_id) {
          setSessionId(finalData.session_id);
          window.localStorage.setItem("iceyoo_session_id", finalData.session_id);
        }
        setMessages((m) => {
          const next = [...m];
          const last = next[next.length - 1];
          next[next.length - 1] = {
            ...last,
            streaming: false,
            // If no chunks arrived (very short reply lost?), fall back to final output.
            text: last.text || finalData.output || "(empty response)",
            tools: finalData.tools_called || [],
          };
          return next;
        });
      }
    } catch (err) {
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = {
          role: "assistant",
          error: true,
          text:
            "Network error — couldn't reach the assistant at " +
            STREAM_URL +
            ". " +
            "Phase 1 ships this API; if it's not running yet, this is expected.",
        };
        return next;
      });
    } finally {
      setLoading(false);
    }
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <React.Fragment>
      {/* backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.35)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.22s ease",
          zIndex: 30,
        }}
      />

      {/* panel */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "78%",
          background: "#fff",
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          boxShadow: "0 -12px 36px rgba(0,0,0,0.18)",
          transform: open ? "translateY(0)" : "translateY(100%)",
          transition: "transform 0.28s cubic-bezier(0.22,0.61,0.36,1)",
          zIndex: 31,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* header */}
        <div
          style={{
            padding: "16px 18px 12px",
            borderBottom: "1px solid #f0f0f0",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: "50%",
              background: "linear-gradient(180deg,#ff8a3d,#f47216)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <IconChat size={18} color="#fff" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#111" }}>
              {RESTAURANT_NAME} Assistant
            </div>
            <div style={{ fontSize: 12, color: "#19a34a", marginTop: 2 }}>
              {loading ? "thinking…" : "online"}
            </div>
          </div>
          {/* VIP demo toggle */}
          <button
            onClick={() => {
              const next = !isVip;
              setIsVip(next);
              window.localStorage.setItem("iceyoo_is_vip", next ? "1" : "0");
              // Clear session — next message starts a fresh history (forces memory fetch)
              window.localStorage.removeItem("iceyoo_session_id");
              setSessionId(null);
              setMessages([
                {
                  role: "assistant",
                  text: next
                    ? "Demo: now logged in as Sarah (VIP customer). Send a message — I should recognize you."
                    : "Demo: anonymous. Memory off.",
                },
              ]);
            }}
            style={{
              height: 30,
              padding: "0 12px",
              borderRadius: 999,
              border: "1px solid " + (isVip ? "#f47216" : "#d0d0d0"),
              background: isVip ? "#fff3e8" : "#fafafa",
              color: isVip ? "#c25500" : "#666",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              flexShrink: 0,
              marginRight: 8,
            }}
            title="Demo toggle — sends customer_id to the agent so it loads Sarah's MemGC profile"
          >
            {isVip ? "★ Demo: Sarah" : "Anonymous"}
          </button>
          <button
            onClick={onClose}
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "none",
              background: "#f5f5f5",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            aria-label="Close chat"
          >
            <IconClose />
          </button>
        </div>

        {/* messages */}
        <div
          ref={scrollerRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 14px",
            background: "#fafafa",
          }}
        >
          {messages.map((m, i) => (
            <ChatBubble
              key={i}
              role={m.role}
              text={m.text}
              tools={m.tools}
              error={m.error}
            />
          ))}
          {loading && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 18,
                  background: "#f1f1f0",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  color: "#888",
                  fontSize: 14,
                }}
              >
                <IconSpinner /> thinking…
              </div>
            </div>
          )}
        </div>

        {/* FAQ chips — visible only on first turn, hidden once a user message is sent */}
        {!messages.some((m) => m.role === "user") && !loading && (
          <div
            style={{
              padding: "10px 12px 0",
              background: "#fff",
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            {[
              { label: "Say hi", text: "hi" },
              { label: "My last order", text: "what's my last order?" },
              { label: "Cheese bingsu?", text: "can I get the cheese bingsu?" },
              { label: "My usual", text: "I want my usual please" },
              { label: "Refund my order", text: "refund my last order" },
            ].map((q) => (
              <button
                key={q.text}
                type="button"
                onClick={() => send(q.text)}
                disabled={loading}
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  border: "1px solid #ffd0aa",
                  background: "#fff8f0",
                  color: "#c25500",
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                {q.label}
              </button>
            ))}
          </div>
        )}

        {/* input */}
        <div
          style={{
            padding: "12px 14px 18px",
            borderTop: "1px solid #f0f0f0",
            background: "#fff",
            display: "flex",
            alignItems: "flex-end",
            gap: 8,
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Ask about the menu, or place an order…"
            rows={1}
            style={{
              flex: 1,
              minHeight: 40,
              maxHeight: 120,
              padding: "10px 14px",
              borderRadius: 22,
              border: "1px solid #e0e0e0",
              fontSize: 15,
              outline: "none",
              resize: "none",
              fontFamily: "inherit",
              lineHeight: 1.35,
              background: "#fafafa",
            }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              border: "none",
              background:
                !input.trim() || loading
                  ? "#cfcfcf"
                  : "linear-gradient(180deg,#ff8a3d,#f47216)",
              cursor: !input.trim() || loading ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "background 0.15s",
            }}
            aria-label="Send"
          >
            {loading ? <IconSpinner size={20} /> : <IconSend />}
          </button>
        </div>
      </div>
    </React.Fragment>
  );
}

// ── chat icon button (compact circular bubble) ───────────────
// `size` lets us drop the same button into the top FloatingActions row
// (size=38 to match the dots/info chips) and elsewhere if needed.
function ChatIconButton({ onClick, size = 38 }) {
  const inner = Math.max(24, size - 8);
  const iconSize = Math.max(16, Math.round(size * 0.5));
  return (
    <button
      onClick={onClick}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: "none",
        background: "#fff",
        boxShadow: "0 3px 10px rgba(0,0,0,0.10)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        position: "relative",
        padding: 0,
      }}
      aria-label="Open chat assistant"
    >
      <div
        style={{
          width: inner,
          height: inner,
          borderRadius: "50%",
          background: "linear-gradient(180deg,#ff8a3d,#f47216)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <IconChat size={iconSize} />
      </div>
      {/* online pulse dot */}
      <span
        style={{
          position: "absolute",
          top: 2,
          right: 2,
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#19a34a",
          border: "2px solid #fff",
        }}
      />
    </button>
  );
}

// expose to global scope so app.jsx (loaded later in index.html) can use them
window.ChatPanel = ChatPanel;
window.ChatIconButton = ChatIconButton;
