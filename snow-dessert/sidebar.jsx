// sidebar.jsx — left sidebar + hash-route hook
// Visual style adapted from ai-contact-bun/ui (dark sectioned sidebar).
// No build step — runs via CDN Babel like the rest of snow-dessert.

const { useState: useSidebarState, useEffect: useSidebarEffect } = React;

const DEFAULT_ROUTE = "app/customer-facing-agent";

const NAV = [
  { type: "header", label: "App" },
  { type: "item", id: "app/customer-facing-agent", label: "Customer-facing Agent" },
  { type: "item", id: "app/kitchen-agent",       label: "Kitchen Agent" },
  { type: "item", id: "app/inventory-agent",     label: "Inventory Agent" },

  { type: "header", label: "Docs" },
  { type: "subheader", label: "Architecture" },
  { type: "item", id: "docs/guide",         label: "Guide",          file: "docs/DEMO_SCRIPT.md" },
  { type: "item", id: "docs/whole-archi",   label: "Whole Archi",    file: "docs/PLAN.md" },
  { type: "item", id: "docs/agents-archi",  label: "Agents Archi",   file: "docs/AGENT_FLOW_KITCHEN_INVENTORY.md" },
  { type: "item", id: "docs/memory-layers", label: "Memory Layers",  file: "docs/REUSE_MEMGC.md" },
  { type: "item", id: "docs/database",      label: "Database",       file: "docs/SCHEMAS.md" },
  { type: "item", id: "docs/mcp",           label: "MCP",            file: "docs/PHASES.md" },
  { type: "item", id: "docs/skills",        label: "Skills",         file: "docs/SKILL_TEMPLATES.md" },
  { type: "item", id: "docs/evals",         label: "Evals/Red Team", file: "docs/EVAL_SCENARIOS.md" },
  { type: "item", id: "docs/cicd",          label: "CI/CD",          file: null },

  { type: "header", label: "Summary" },
  { type: "item", id: "summary",            label: "Summary",        file: "README.md" },
];

function getRouteFromHash() {
  return (window.location.hash || "#" + DEFAULT_ROUTE).slice(1);
}

function useHashRoute() {
  const [route, setRoute] = useSidebarState(getRouteFromHash());
  useSidebarEffect(() => {
    const handler = () => setRoute(getRouteFromHash());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  return route;
}

function findNavItem(routeId) {
  return NAV.find((n) => n.type === "item" && n.id === routeId) || null;
}

function Sidebar() {
  const route = useHashRoute();
  return (
    <aside className="fm-sidebar">
      <div className="fm-brand">
        <div className="fm-brand-mark">F</div>
        <div>
          <div className="fm-brand-name">FeedMe</div>
          <div className="fm-brand-sub">Agentic AI · Prototype</div>
        </div>
      </div>
      <nav className="fm-nav">
        {NAV.map((n, i) => {
          if (n.type === "header") return <div key={i} className="fm-section-header">{n.label}</div>;
          if (n.type === "subheader") return <div key={i} className="fm-section-sub">{n.label}</div>;
          const cls = "fm-item" + (route === n.id ? " active" : "");
          return <a key={i} href={"#" + n.id} className={cls}>{n.label}</a>;
        })}
      </nav>
      <div className="fm-foot">
        <a href="https://github.com/carrickcheah/ai-feedme" target="_blank" rel="noreferrer">
          github.com/carrickcheah/ai-feedme
        </a>
      </div>
    </aside>
  );
}

Object.assign(window, { Sidebar, useHashRoute, findNavItem, NAV, DEFAULT_ROUTE });
