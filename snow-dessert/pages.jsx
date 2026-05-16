// pages.jsx — non-kiosk page components.
// MarkdownPage fetches from GitHub raw, parses via marked CDN,
// sanitizes via DOMPurify CDN before injecting.

const { useState: usePageState, useEffect: usePageEffect } = React;

const RAW_BASE = "https://raw.githubusercontent.com/carrickcheah/ai-feedme/main/";

function renderMarkdownSafely(md) {
  if (!window.marked) return { __html: "" };
  const raw = window.marked.parse(md);
  const clean = window.DOMPurify ? window.DOMPurify.sanitize(raw) : raw;
  return { __html: clean };
}

// ─── Markdown page ──────────────────────────────────────────────
function MarkdownPage({ file, title }) {
  const [md, setMd] = usePageState("");
  const [error, setError] = usePageState(null);

  usePageEffect(() => {
    if (!file) return;
    setMd("");
    setError(null);
    const url = RAW_BASE + file;
    fetch(url)
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

// ─── Agent info card ────────────────────────────────────────────
function AgentInfoPage({ name, role, trigger, allowed, downstream, tools, source }) {
  return (
    <div className="fm-doc">
      <h1 className="fm-doc-title">{name}</h1>
      <div className="fm-agent-meta">
        <div><strong>Role:</strong> {role}</div>
        <div><strong>Triggered by:</strong> <code>{trigger}</code></div>
        <div><strong>MCP allowlist:</strong> {allowed.map((a, i) => (
          <React.Fragment key={a}>{i > 0 && " "}<code>{a}</code></React.Fragment>
        ))}</div>
        <div><strong>Publishes downstream:</strong> {downstream ? <code>{downstream}</code> : "(terminal)"}</div>
      </div>
      <h2>Tools commonly called</h2>
      <ul>
        {tools.map((t) => <li key={t}><code>{t}</code></li>)}
      </ul>
      <div className="fm-agent-src">
        Source: <code>{source}</code> · Shared loop: <code>src/agents/agent-base.ts</code>
      </div>
    </div>
  );
}

function KitchenAgentPage() {
  return (
    <AgentInfoPage
      name="Kitchen Agent"
      role="Event-driven. Builds a synthetic prompt from the order payload, fires kitchen-display + supplier tool calls, then dedupes by ingredient and publishes one ingredient.consumed event per unique ingredient."
      trigger="order.created"
      allowed={["pos", "kitchen-display", "supplier"]}
      downstream="ingredient.consumed"
      tools={[
        "kitchen-display__send_ticket",
        "supplier__record_ingredient_consumption",
        "pos__search_menu (optional, for menu metadata)",
      ]}
      source="src/agents/kitchen.ts"
    />
  );
}

function InventoryAgentPage() {
  return (
    <AgentInfoPage
      name="Inventory Agent"
      role="Event-driven. Checks par level on each consumption. Reorders via supplier__place_order when stock <= par. If stock < par, publishes stock.low which flips affected menu_items to is_available=0 via the 86-propagator."
      trigger="ingredient.consumed"
      allowed={["supplier"]}
      downstream="stock.low → 86-propagator (SQL only)"
      tools={[
        "supplier__get_ingredient_stock",
        "supplier__list_suppliers",
        "supplier__place_order",
      ]}
      source="src/agents/inventory.ts"
    />
  );
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
  AgentInfoPage,
  KitchenAgentPage,
  InventoryAgentPage,
  ComingSoonPage,
});
