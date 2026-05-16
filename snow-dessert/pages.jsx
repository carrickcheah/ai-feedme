// pages.jsx — non-kiosk page components.
// MarkdownPage fetches from GitHub raw, parses via marked CDN,
// sanitizes via DOMPurify CDN before injecting.
// DashboardPage renders KPI cards + chart + activity feed + Liquid-style chat bar.

const { useState: usePageState, useEffect: usePageEffect, useRef: usePageRef } = React;

const RAW_BASE = "https://raw.githubusercontent.com/carrickcheah/ai-feedme/main/";
const CHAT_API_URL =
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? "http://localhost:8002/api/chat/sync"
    : "/api/chat/sync";

function renderMarkdownSafely(md) {
  if (!window.marked) return { __html: "" };
  const raw = window.marked.parse(md);
  const clean = window.DOMPurify ? window.DOMPurify.sanitize(raw) : raw;
  return { __html: clean };
}

// ─── SVG page (architecture diagrams etc) ──────────────────────
// Cache-bust the SVG URL with a per-page-load timestamp so iterative
// diagram edits surface immediately without forcing a hard-reload.
function SvgPage({ src, title }) {
  const cb = usePageRef(Date.now()).current;
  const url = `${RAW_BASE}${src}?cb=${cb}`;
  return (
    <div className="fm-doc fm-svg-page">
      {title && <h1 className="fm-doc-title">{title}</h1>}
      <div className="fm-svg-wrap">
        <img src={url} alt={title || "diagram"} className="fm-svg-img" />
      </div>
    </div>
  );
}

// ─── Markdown page ──────────────────────────────────────────────
function MarkdownPage({ file, title }) {
  const [md, setMd] = usePageState("");
  const [error, setError] = usePageState(null);

  usePageEffect(() => {
    if (!file) return;
    setMd("");
    setError(null);
    fetch(RAW_BASE + file)
      .then((r) => r.ok ? r.text() : Promise.reject(new Error("HTTP " + r.status)))
      .then(setMd)
      .catch((e) => setError(e.message));
  }, [file]);

  return (
    <div className="fm-doc">
      {title && <h1 className="fm-doc-title">{title}</h1>}
      {error ? (
        <div className="fm-doc-error">
          Could not load <code>{file}</code>: {error}
        </div>
      ) : md ? (
        <div className="fm-md" dangerouslySetInnerHTML={renderMarkdownSafely(md)} />
      ) : (
        <div className="fm-doc-loading">Loading {file}…</div>
      )}
    </div>
  );
}

// ─── Liquid-style sticky chat bar with pop-up thread ────────────
function DashboardChatBar({ agentLabel }) {
  const [input, setInput] = usePageState("");
  const [messages, setMessages] = usePageState([]);
  const [loading, setLoading] = usePageState(false);
  const [sessionId, setSessionId] = usePageState(null);
  const [open, setOpen] = usePageState(false);
  const threadRef = usePageRef(null);
  const inputRef = usePageRef(null);

  // Auto-scroll thread on new content.
  usePageEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, loading]);

  // Refocus the input after the LLM response lands, so the user can
  // immediately type the next message without re-clicking.
  usePageEffect(() => {
    if (!loading && open && inputRef.current) {
      const id = setTimeout(() => inputRef.current && inputRef.current.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [loading, open]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setOpen(true);
    setLoading(true);
    try {
      const res = await fetch(CHAT_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: sessionId, channel: "web" }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (data.session_id) setSessionId(data.session_id);
      setMessages((m) => [...m, { role: "assistant", text: data.output || "(no response)" }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", text: "Connection error: " + (err.message || err) }]);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <React.Fragment>
      {open && (messages.length > 0 || loading) && (
        <div className="fm-chatpop">
          <div className="fm-chatpop-head">
            <span className="fm-chatpop-title">Chat with {agentLabel}</span>
            <div className="fm-chatpop-actions">
              <button
                className="fm-chatpop-btn"
                aria-label="Minimize chat"
                title="Minimize"
                onClick={() => setOpen(false)}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M3 12h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
              <button
                className="fm-chatpop-btn"
                aria-label="Close chat (clears thread)"
                title="Close (clears thread)"
                onClick={() => { setOpen(false); setMessages([]); setSessionId(null); }}
              >×</button>
            </div>
          </div>
          <div className="fm-chatpop-thread" ref={threadRef}>
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "fm-chatpop-user" : "fm-chatpop-asst"}>
                {m.text}
              </div>
            ))}
            {loading && <div className="fm-chatpop-asst fm-chatpop-typing">…</div>}
          </div>
        </div>
      )}
      <div className="fm-chatbar">
        <input
          ref={inputRef}
          className="fm-chatbar-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => { if (messages.length > 0) setOpen(true); }}
          onKeyDown={onKeyDown}
          placeholder={loading ? "Waiting for response…" : `Chat with ${agentLabel}…`}
        />
        <button
          className={"fm-chatbar-send" + (input.trim() && !loading ? " active" : "")}
          onClick={send}
          disabled={loading || !input.trim()}
          aria-label="Send"
        >
          {loading ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25"/>
              <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite"/>
              </path>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M9 17V8.5L19 12L9 15.5V17z" fill="currentColor"/>
              <path d="M5 12h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          )}
        </button>
      </div>
    </React.Fragment>
  );
}

// ─── KPI card grid + chart + activity feed dashboard ────────────
function KPI({ value, label, tone }) {
  return (
    <div className="fm-kpi">
      <div className={"fm-kpi-value" + (tone ? " " + tone : "")}>{value}</div>
      <div className="fm-kpi-label">{label}</div>
    </div>
  );
}

function BarChart({ title, values, labels }) {
  const max = Math.max(...values, 1);
  return (
    <div className="fm-card">
      <div className="fm-card-title">{title}</div>
      <div className="fm-chart-bars">
        {values.map((v, i) => (
          <div key={i} className="fm-chart-col">
            <div className="fm-chart-bar" style={{ height: (v / max * 100) + "%" }} />
            <div className="fm-chart-label">{labels[i]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityFeed({ title, rows }) {
  return (
    <div className="fm-card">
      <div className="fm-card-title">{title}</div>
      <div className="fm-activity">
        {rows.map((r, i) => (
          <div key={i} className="fm-activity-row">
            <span className="fm-activity-time">{r.time}</span>
            <span className="fm-activity-id">{r.id}</span>
            <span className="fm-activity-text">{r.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardPage({ agent, tagline, kpis, chart, activity, agentLabel }) {
  return (
    <div className="fm-dashboard">
      <div className="fm-dash-head">
        <h1 className="fm-dash-title">{agent}</h1>
        <div className="fm-dash-tagline">{tagline}</div>
      </div>
      <div className="fm-kpi-grid">
        {kpis.map((k, i) => <KPI key={i} {...k} />)}
      </div>
      <BarChart {...chart} />
      <ActivityFeed title="Recent activity" rows={activity} />
      <DashboardChatBar agentLabel={agentLabel} />
    </div>
  );
}

// ─── Mock data for each agent dashboard ─────────────────────────
const KITCHEN_DATA = {
  agent: "Kitchen Agent (Internal Support)",
  agentLabel: "Kitchen Agent",
  tagline: "Event-driven · triggers on order.created · MCPs: pos, kitchen-display, supplier",
  kpis: [
    { value: "24",     label: "tickets today" },
    { value: "7m 22s", label: "avg cook time" },
    { value: "95%",    label: "on-time rate" },
    { value: "3",      label: "in queue", tone: "warn" },
  ],
  chart: {
    title: "Tickets per hour",
    labels: ["9a","10a","11a","12p","1p","2p","3p","4p","5p","6p"],
    values: [1, 2, 3, 4, 6, 8, 6, 3, 2, 1],
  },
  activity: [
    { time: "14:32", id: "ORD-9871", text: "Mango Iceyoo × 2 · sent to bar" },
    { time: "14:28", id: "ORD-9870", text: "(Any 2) YooYoo Saver · in progress" },
    { time: "14:25", id: "ORD-9869", text: "Korean Chicken Wings (6 pcs)" },
    { time: "14:21", id: "ORD-9868", text: "Oreo Cheesecake Bingsu" },
    { time: "14:17", id: "ORD-9867", text: "Mango Iceyoo × 1 · completed" },
    { time: "14:11", id: "ORD-9866", text: "Tutti Frutti Ice Blended" },
  ],
};

const INVENTORY_DATA = {
  agent: "Inventory Agent (Internal Support)",
  agentLabel: "Inventory Agent",
  tagline: "Event-driven · triggers on ingredient.consumed · MCP: supplier",
  kpis: [
    { value: "47", label: "ingredients" },
    { value: "3",  label: "below par",     tone: "warn" },
    { value: "2",  label: "reorders today" },
    { value: "5",  label: "items 86'd",    tone: "warn" },
  ],
  chart: {
    title: "Stock levels (% of par)",
    labels: ["Mango","Milk","Oreo","Ice","Cream","Chicken","Sugar","Strawberry","Coffee","Mint"],
    values: [85, 72, 40, 90, 15, 60, 25, 80, 55, 35],
  },
  activity: [
    { time: "14:30", id: "STOCK.LOW", text: "Cream cheese: 0.5kg / 3kg par" },
    { time: "14:25", id: "REORDER",   text: "Mango syrup × 5kg · supplier B" },
    { time: "13:50", id: "STOCK.LOW", text: "Oreo crumbs: 0.2kg / 1kg par" },
    { time: "13:45", id: "AUTO-86",   text: "Oreo Cheesecake Bingsu disabled" },
    { time: "13:40", id: "REORDER",   text: "Chicken wings × 10kg · supplier A" },
    { time: "13:22", id: "STOCK.LOW", text: "Mint leaves: 80g / 200g par" },
  ],
};

function KitchenAgentPage()   { return <DashboardPage {...KITCHEN_DATA} />; }
function InventoryAgentPage() { return <DashboardPage {...INVENTORY_DATA} />; }

// ─── Placeholder for items without a backing doc ────────────────
function ComingSoonPage({ what }) {
  return (
    <div className="fm-doc">
      <h1 className="fm-doc-title">{what}</h1>
      <p>This section isn't part of the interview prototype scope. The build artifacts are in the repo:</p>
      <ul>
        <li><a href="https://github.com/carrickcheah/ai-feedme/actions" target="_blank" rel="noreferrer">GitHub Actions (CI status)</a></li>
        <li><a href="https://github.com/carrickcheah/ai-feedme/commits/main" target="_blank" rel="noreferrer">Commit history</a></li>
        <li><a href="https://github.com/carrickcheah/ai-feedme" target="_blank" rel="noreferrer">Repo root</a></li>
      </ul>
      <p>For interview demo, the eval loop in <code>bun run eval</code> stands in for full CI/CD — it's the test gate that would block a merge.</p>
    </div>
  );
}

Object.assign(window, {
  MarkdownPage,
  SvgPage,
  KitchenAgentPage,
  InventoryAgentPage,
  ComingSoonPage,
  DashboardPage,
  DashboardChatBar,
});
