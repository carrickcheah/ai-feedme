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

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setLoading(true);

    try {
      const res = await fetch(CHAT_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          session_id: sessionId,
          channel: "mobile",
        }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            error: true,
            text:
              "Sorry, the assistant is unreachable right now (HTTP " +
              res.status +
              "). " +
              "Make sure the backend is running: " +
              "`cd ai-feedme && make up && make dev`",
          },
        ]);
        return;
      }

      const data = await res.json();
      if (data.session_id) {
        setSessionId(data.session_id);
        window.localStorage.setItem("iceyoo_session_id", data.session_id);
      }
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: data.output || "(empty response)",
          tools: data.tools_called || [],
        },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          error: true,
          text:
            "Network error — couldn't reach the assistant at " +
            CHAT_API_URL +
            ". " +
            "Phase 1 ships this API; if it's not running yet, this is expected.",
        },
      ]);
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

// ── chat icon button (used in BottomBar) ─────────────────────
function ChatIconButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 52,
        height: 52,
        borderRadius: "50%",
        border: "none",
        background: "#fff",
        boxShadow: "0 4px 10px rgba(0,0,0,0.12)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        position: "relative",
      }}
      aria-label="Open chat assistant"
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: "linear-gradient(180deg,#ff8a3d,#f47216)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <IconChat />
      </div>
      {/* small pulse dot */}
      <span
        style={{
          position: "absolute",
          top: 4,
          right: 4,
          width: 10,
          height: 10,
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
