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
function DashboardChatBar({ agentLabel, stats }) {
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

  // Map dashboard agent → a synthetic "customer_id" that loads its persona
  // profile (.md file under src/agents/prompts/customer-profiles/). The LLM
  // sees this as memory context and answers questions about that agent's
  // current state — same fast-path the kiosk uses for Sarah.
  const personaId = agentLabel === "Inventory Agent"
    ? "agent_inventory"
    : "agent_kitchen";

  const send = async (overrideText) => {
    const text = (typeof overrideText === "string" ? overrideText : input).trim();
    if (!text || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setMessages((m) => [...m, { role: "assistant", text: "" }]);
    setOpen(true);
    setLoading(true);

    // /api/chat/sync → /api/chat (SSE) — same streaming pattern as the
    // customer-facing kiosk so dashboard replies trickle in token-by-token
    // instead of arriving as a single blob after the LLM completes.
    const STREAM_URL = CHAT_API_URL.replace(/\/sync$/, "");

    try {
      const res = await fetch(STREAM_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          message: text,
          session_id: sessionId,
          channel: "web",
          customer_id: personaId,
        }),
      });
      if (!res.ok || !res.body) throw new Error("HTTP " + res.status);

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
          for (const line of part.split("\n")) {
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
                } else if (currentEvent === "done") finalData = data;
              } catch { /* skip malformed */ }
            }
          }
        }
      }

      if (finalData && finalData.session_id) setSessionId(finalData.session_id);
    } catch (err) {
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = { role: "assistant", text: "Connection error: " + (err.message || err) };
        return next;
      });
    } finally {
      setLoading(false);
    }
  };

  // Per-agent FAQ chips. Each click sends a real chat request — the LLM
  // answers from the persona .md (loaded as memory context via personaId).
  const KITCHEN_FAQ = [
    { label: "Kitchen queue", text: "How busy is the kitchen right now?" },
    { label: "Avg cook time", text: "What is today's average cook time?" },
    { label: "Recent tickets", text: "Show me the recent kitchen tickets" },
    { label: "Busiest station", text: "Which kitchen station is busiest today?" },
    { label: "On-time rate", text: "What is the on-time rate today?" },
  ];
  const INVENTORY_FAQ = [
    { label: "Low stock", text: "Which ingredients are below par right now?" },
    { label: "Today's reorders", text: "What supplier orders went out today?" },
    { label: "86'd items", text: "Which menu items are 86'd right now?" },
    { label: "Suppliers", text: "Who are our suppliers?" },
    { label: "Stock summary", text: "Give me an inventory stock summary" },
  ];
  const faqPrompts = agentLabel === "Inventory Agent" ? INVENTORY_FAQ : KITCHEN_FAQ;

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
              m.role === "user" ? (
                <div key={i} className="fm-chatpop-user">{m.text}</div>
              ) : (
                <div
                  key={i}
                  className="fm-chatpop-asst fm-md"
                  dangerouslySetInnerHTML={renderMarkdownSafely(m.text || "")}
                />
              )
            ))}
            {loading && <div className="fm-chatpop-asst fm-chatpop-typing">…</div>}
            {/* FAQ chips rendered INSIDE the chat thread after the last
                message — interviewer can click another prompt without
                leaving the popup. Always visible (except while loading). */}
            {!loading && (
              <div className="fm-chatpop-faq">
                {faqPrompts.map((q) => (
                  <button
                    key={q.text}
                    type="button"
                    className="fm-chatbar-chip"
                    onClick={() => send(q.text)}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {!loading && (
        <div className="fm-chatbar-faq">
          {faqPrompts.map((q) => (
            <button
              key={q.text}
              type="button"
              className="fm-chatbar-chip"
              onClick={() => send(q.text)}
              disabled={loading}
            >
              {q.label}
            </button>
          ))}
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

// Small inline icon set — stroke-based, scale to currentColor.
const KPI_ICONS = {
  ticket: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 100 4v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2a2 2 0 100-4V8z"/><path d="M13 6v2M13 11v2M13 16v2"/></svg>,
  clock:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>,
  check:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>,
  queue:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4h12M8 4v6l-4 7h16l-4-7V4"/></svg>,
  pkg:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/></svg>,
  alert:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4l10 17H2L12 4z"/><path d="M12 10v5M12 18v.5"/></svg>,
  truck:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>,
  off:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M6 6l12 12"/></svg>,
};

function TrendDelta({ trend }) {
  if (!trend) return null;
  const dir = trend.dir || "flat";
  const arrow = dir === "up" ? "↑" : dir === "down" ? "↓" : "→";
  const good = (trend.good !== undefined) ? trend.good : (dir === "up");
  const cls = "fm-kpi-trend " + (dir === "flat" ? "flat" : (good ? "good" : "bad"));
  return (
    <div className={cls}>
      <span className="fm-kpi-trend-arrow">{arrow}</span>
      <span>{trend.delta}</span>
      {trend.vs && <span className="fm-kpi-trend-vs">{trend.vs}</span>}
    </div>
  );
}

function KPI({ icon, value, label, tone, trend }) {
  return (
    <div className={"fm-kpi" + (tone ? " " + tone : "")}>
      {icon && KPI_ICONS[icon] && (
        <div className="fm-kpi-icon">{KPI_ICONS[icon]}</div>
      )}
      <div className="fm-kpi-main">
        <div className={"fm-kpi-value" + (tone ? " " + tone : "")}>{value}</div>
        <div className="fm-kpi-label">{label}</div>
        <TrendDelta trend={trend} />
      </div>
    </div>
  );
}

const CHART_PX = 130;   // max bar height in pixels — keeps bars visible regardless of container layout

function barTone(v, scale) {
  // For 0–100 scales: <25 = red, 25–50 = amber, >50 = healthy. For other scales,
  // fall back to "neutral" so the chart stays orange-brand by default.
  if (!scale || scale !== "percent") return "neutral";
  if (v < 25) return "low";
  if (v < 50) return "mid";
  return "ok";
}

function BarChart({ title, values, labels, scale }) {
  const max = Math.max(...values, 1);
  return (
    <div className="fm-card">
      <div className="fm-card-title">{title}</div>
      <div className="fm-chart-bars">
        {values.map((v, i) => {
          const tone = barTone(v, scale);
          const px = Math.max(4, Math.round((v / max) * CHART_PX));
          return (
            <div key={i} className="fm-chart-col">
              <div className="fm-chart-value">{v}{scale === "percent" ? "%" : ""}</div>
              <div className={"fm-chart-bar fm-chart-bar-" + tone} style={{ height: px + "px" }} />
              <div className="fm-chart-label">{labels[i]}</div>
            </div>
          );
        })}
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
            {r.status && (
              <span className={"fm-activity-status fm-status-" + r.status.toLowerCase().replace(/[._]/g, "-")}>
                {r.status}
              </span>
            )}
            <span className="fm-activity-id">{r.id}</span>
            <span className="fm-activity-text">{r.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const ADMIN_API_BASE =
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? "http://localhost:8002/api/admin"
    : "/api/admin";

/**
 * DashboardPage now accepts a `statsUrl` to fetch live data from. The
 * static props (agent, tagline, agentLabel) come from the parent; KPIs,
 * chart, activity, and status are server-fed and refresh every 30s.
 */
function DashboardPage({ agent, tagline, agentLabel, statsUrl, initial }) {
  const [data, setData] = usePageState(initial || {});
  const [loading, setLoading] = usePageState(true);
  const [error, setError] = usePageState(null);

  const load = () => {
    if (!statsUrl) return;
    fetch(ADMIN_API_BASE + statsUrl)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))
      .then((d) => { setData(d); setError(null); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  };

  usePageEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [statsUrl]);

  const kpis = data.kpis || initial?.kpis || [];
  const chart = data.chart || initial?.chart;
  const activity = data.activity || initial?.activity || [];
  const status = data.status || initial?.status;

  return (
    <div className="fm-dashboard">
      <div className="fm-dash-head">
        <div className="fm-dash-head-text">
          <h1 className="fm-dash-title">{agent}</h1>
          <div className="fm-dash-tagline">{tagline}</div>
          {error && <div className="fm-dash-error">live data unavailable: {error} — showing seed values</div>}
        </div>
        {status && (
          <div className="fm-dash-status">
            <span className="fm-dash-status-dot" />
            <div>
              <div className="fm-dash-status-label">{status.label}</div>
              <div className="fm-dash-status-since">{status.since}</div>
            </div>
          </div>
        )}
      </div>
      <div className="fm-kpi-grid">
        {kpis.map((k, i) => <KPI key={i} {...k} />)}
      </div>
      {chart && <BarChart {...chart} />}
      <ActivityFeed title="Recent activity" rows={activity} />
      <DashboardChatBar agentLabel={agentLabel} stats={data} />
    </div>
  );
}

// ─── Mock data for each agent dashboard ─────────────────────────
const KITCHEN_DATA = {
  agent: "Kitchen Agent (Internal Support)",
  agentLabel: "Kitchen Agent",
  tagline: "Event-driven · triggers on order.created · MCPs: pos, kitchen-display, supplier",
  status: { label: "Live", since: "updated 2m ago" },
  kpis: [
    { icon: "ticket", value: "24",     label: "tickets today",  trend: { delta: "+12%", dir: "up",   vs: "vs yesterday" } },
    { icon: "clock",  value: "7m 22s", label: "avg cook time",  trend: { delta: "-30s", dir: "down", vs: "vs yesterday", good: true } },
    { icon: "check",  value: "95%",    label: "on-time rate",   trend: { delta: "+2pp", dir: "up",   vs: "vs yesterday" } },
    { icon: "queue",  value: "3",      label: "in queue", tone: "warn", trend: { delta: "near par", dir: "flat" } },
  ],
  chart: {
    title: "Tickets per hour",
    labels: ["9a","10a","11a","12p","1p","2p","3p","4p","5p","6p"],
    values: [1, 2, 3, 4, 6, 8, 6, 3, 2, 1],
  },
  activity: [
    { time: "14:32", id: "ORD-9871", text: "Mango Iceyoo × 2",          status: "SENT" },
    { time: "14:28", id: "ORD-9870", text: "(Any 2) YooYoo Saver",      status: "COOKING" },
    { time: "14:25", id: "ORD-9869", text: "Korean Chicken Wings (6 pcs)", status: "COOKING" },
    { time: "14:21", id: "ORD-9868", text: "Oreo Cheesecake Bingsu",    status: "READY" },
    { time: "14:17", id: "ORD-9867", text: "Mango Iceyoo × 1",          status: "DONE" },
    { time: "14:11", id: "ORD-9866", text: "Tutti Frutti Ice Blended",  status: "DONE" },
  ],
};

const INVENTORY_DATA = {
  agent: "Inventory Agent (Internal Support)",
  agentLabel: "Inventory Agent",
  tagline: "Event-driven · triggers on ingredient.consumed · MCP: supplier",
  status: { label: "Live", since: "updated 1m ago" },
  kpis: [
    { icon: "pkg",   value: "47", label: "ingredients",     trend: { delta: "+2",   dir: "up",   vs: "this week" } },
    { icon: "alert", value: "3",  label: "below par", tone: "warn", trend: { delta: "+1",   dir: "up",   vs: "since 1pm", good: false } },
    { icon: "truck", value: "2",  label: "reorders today",  trend: { delta: "on track", dir: "flat" } },
    { icon: "off",   value: "5",  label: "items 86'd", tone: "warn", trend: { delta: "+2",   dir: "up",   vs: "vs yesterday", good: false } },
  ],
  chart: {
    title: "Stock levels (% of par)",
    scale: "percent",
    labels: ["Mango","Milk","Oreo","Ice","Cream","Chicken","Sugar","Strawberry","Coffee","Mint"],
    values: [95, 78, 32, 88, 12, 65, 22, 82, 58, 42],
  },
  activity: [
    { time: "14:30", id: "ING-204",  text: "Cream cheese: 0.5kg / 3kg par", status: "STOCK.LOW" },
    { time: "14:25", id: "PO-1142",  text: "Mango syrup × 5kg · supplier B", status: "REORDER" },
    { time: "13:50", id: "ING-118",  text: "Oreo crumbs: 0.2kg / 1kg par",  status: "STOCK.LOW" },
    { time: "13:45", id: "MENU-22",  text: "Oreo Cheesecake Bingsu disabled", status: "AUTO-86" },
    { time: "13:40", id: "PO-1141",  text: "Chicken wings × 10kg · supplier A", status: "REORDER" },
    { time: "13:22", id: "ING-067",  text: "Mint leaves: 80g / 200g par",   status: "STOCK.LOW" },
  ],
};

function KitchenAgentPage() {
  return <DashboardPage
    agent={KITCHEN_DATA.agent}
    agentLabel={KITCHEN_DATA.agentLabel}
    tagline={KITCHEN_DATA.tagline}
    statsUrl="/kitchen-stats"
    initial={KITCHEN_DATA}
  />;
}
function InventoryAgentPage() {
  return <DashboardPage
    agent={INVENTORY_DATA.agent}
    agentLabel={INVENTORY_DATA.agentLabel}
    tagline={INVENTORY_DATA.tagline}
    statsUrl="/inventory-stats"
    initial={INVENTORY_DATA}
  />;
}

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
