import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowDown,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Box,
  BrainCircuit,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Command,
  Database,
  Download,
  ExternalLink,
  FileText,
  Filter,
  GitBranch,
  GitCompareArrows,
  Globe2,
  History,
  LayoutDashboard,
  ListFilter,
  LoaderCircle,
  LockKeyhole,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Network,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Terminal,
  TriangleAlert,
  Waypoints,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { api } from "./api";
import {
  AGENTS,
  type AgentId,
  type Entity,
  type MemoryType,
  type Snapshot,
  type ToolTrace,
} from "./types";

type View = "overview" | "incidents" | "memory" | "agents" | "settings";
const views = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "incidents", label: "Incidents", icon: Activity },
  { id: "memory", label: "Shared memory", icon: Network },
  { id: "agents", label: "Agent team", icon: Box },
] as const;
const labels: Record<string, string> = {
  open: "Ready to investigate",
  investigating: "Investigating",
  awaiting_approval: "Needs your approval",
  paused: "Paused",
  resolving: "Recovering",
  resolved: "Resolved",
  error: "Needs attention",
};
const relative = (time: number) => {
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  return minutes < 1
    ? "Just now"
    : minutes < 60
      ? `${minutes}m ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : `${Math.floor(minutes / 1440)}d ago`;
};
const timestamp = (time: number) =>
  new Date(time).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
const agentBy = (id: string) => AGENTS.find((a) => a.id === id);
const nodeLabel = (n: Entity | undefined, id: string) =>
  n?.name ?? n?.number ?? n?.title ?? id;
const TOOL_LABELS: Record<string, string> = {
  suspects: "Upstream suspects",
  similar_incidents: "Similar incidents",
  blast_radius: "Blast radius",
  decisions: "Decisions",
  who_knows: "Who knows this",
  memories: "Memory lookup",
  path: "Path",
};

/** The graph queries an agent ran, with the paths behind each answer. */
function TraceList({
  traces,
  nodes,
  simulated,
}: {
  traces: ToolTrace[];
  nodes: Entity[];
  simulated?: boolean;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <div className="trace-list">
      <div className="trace-header">
        <Waypoints size={12} />
        <span>
          {traces.length} graph {traces.length === 1 ? "query" : "queries"}
          {simulated ? " · deterministic" : " · model-selected"}
        </span>
      </div>
      {traces.map((t, i) => {
        const args = Object.values(t.args).map(String).join(" → ");
        const paths = (t.paths ?? []).slice(0, 8);
        return (
          <div className={`trace ${open === i ? "open" : ""}`} key={i}>
            <button onClick={() => setOpen(open === i ? null : i)}>
              <code>{TOOL_LABELS[t.tool] ?? t.tool}</code>
              <span>{args}</span>
              <em>{t.summary}</em>
              <ChevronDown size={12} />
            </button>
            {open === i && paths.length > 0 && (
              <ul>
                {paths.map((p, j) => (
                  <li key={j}>
                    <b>{nodeLabel(byId.get(p.from), p.from)}</b>
                    <i>{p.relation}</i>
                    <b>{nodeLabel(byId.get(p.to), p.to)}</b>
                  </li>
                ))}
                {(t.paths?.length ?? 0) > 8 && (
                  <li className="more">+{t.paths!.length - 8} more</li>
                )}
              </ul>
            )}
            {open === i && paths.length === 0 && t.nodeIds.length > 0 && (
              <ul>
                {t.nodeIds.slice(0, 8).map((id) => (
                  <li key={id}>
                    <b>{nodeLabel(byId.get(id), id)}</b>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? "small" : ""}`}>
      <span className="brand-mark">
        <svg viewBox="0 0 32 32" fill="none">
          <path
            d="M6 24V9h11a6 6 0 0 1 0 12h-5M17 15h10m-4-4 4 4-4 4"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {!small && (
        <span>
          relay<span className="brand-light">ops</span>
          <i />
        </span>
      )}
    </div>
  );
}
function AgentAvatar({ id, size = "" }: { id: string; size?: string }) {
  const agent = agentBy(id);
  const Icon =
    id === "atlas"
      ? Waypoints
      : id === "sage"
        ? GitBranch
        : id === "echo"
          ? ShieldCheck
          : id === "you"
            ? Command
            : Radio;
  return (
    <span
      className={`agent-avatar ${size}`}
      style={
        { "--agent-color": agent?.color ?? "#678777" } as React.CSSProperties
      }
    >
      <Icon size={size === "large" ? 27 : 17} />
    </span>
  );
}
function Badge({ status }: { status: string }) {
  return (
    <span className={`badge status-${status}`}>
      <i />
      {labels[status] ?? status}
    </span>
  );
}
function MemoryIcon({ category }: { category: string }) {
  const Icon =
    category === "semantic"
      ? BrainCircuit
      : category === "procedural"
        ? GitBranch
        : History;
  return (
    <span className={`memory-icon ${category}`}>
      <Icon size={16} />
    </span>
  );
}
function Empty({
  icon: Icon = Search,
  title,
  text,
  children,
}: {
  icon?: typeof Search;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={24} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const els = ref.current?.querySelectorAll<HTMLElement>(
          "button, input, select, textarea, a[href]",
        );
        if (!els?.length) return;
        const first = els[0],
          last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input, button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            onClick={close}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export default function App({
  initialState = null,
}: {
  initialState?: Snapshot | null;
}) {
  const [state, setState] = useState<Snapshot | null>(initialState);
  const [view, setView] = useState<View>("overview");
  const [selected, setSelected] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : localStorage.getItem("relayops.selected"),
  );
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState<"new" | "search" | "guide" | null>(null);
  const [memoryDetail, setMemoryDetail] = useState<Entity | null>(null);
  const [tenantOpen, setTenantOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [login, setLogin] = useState(false);
  const [code, setCode] = useState("");
  const tenantEpoch = useRef(0);
  useEffect(() => {
    if (selected) localStorage.setItem("relayops.selected", selected);
    else localStorage.removeItem("relayops.selected");
  }, [selected]);
  const load = useCallback(async () => {
    const epoch = tenantEpoch.current;
    try {
      const next = await api<Snapshot>("/state");
      if (epoch === tenantEpoch.current) {
        setState(next);
        setOffline(false);
        setLogin(false);
      }
    } catch (e: any) {
      if (e.status === 401) setLogin(true);
      else setOffline(true);
    }
  }, []);
  useEffect(() => {
    (async () => {
      try {
        await api("/state");
        await load();
      } catch {
        try {
          await api("/session", {});
          await load();
        } catch {
          setLogin(true);
        }
      }
    })();
    const timer = setInterval(load, 1700);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setModal("search");
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 4200);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const mutate = async (path: string, data: unknown, success?: string) => {
    setBusy(true);
    setError("");
    try {
      const result = await api(path, data);
      await load();
      if (success) setToast(success);
      return result;
    } catch (e: any) {
      setError(e.message);
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const safeAction = (id: string, action: string) => {
    void mutate(
      `/incidents/${id}/action`,
      { action },
      action === "migrate"
        ? "Memory updated. The outdated plan has been invalidated."
        : undefined,
    ).catch(() => {});
  };
  const changeTenant = async (id: string) => {
    tenantEpoch.current++;
    setTenantOpen(false);
    setSelected(null);
    setMemoryDetail(null);
    setState(null);
    try {
      await mutate("/workspace", { id });
    } catch {
      await load();
    }
  };
  const navigate = (v: View) => {
    setView(v);
    setMobileNav(false);
  };
  const nodes = state?.nodes ?? [];
  const incidents = nodes
    .filter((n) => n.kind === "incident")
    .sort((a, b) => b.createdAt - a.createdAt);
  const active = incidents.filter((i) => i.status !== "resolved");
  const memories = nodes
    .filter((n) => n.kind === "memory")
    .sort((a, b) => b.createdAt - a.createdAt);
  const current =
    incidents.find((i) => i.id === selected) ?? active[0] ?? incidents[0];
  const openIncident = (id: string) => {
    setSelected(id);
    setView("overview");
    setModal(null);
  };

  if (login)
    return (
      <div className="login-screen">
        <div className="login-card">
          <Logo />
          <p className="eyebrow">A TEAM THAT REMEMBERS</p>
          <h1>
            Welcome to your
            <br />
            incident workspace.
          </h1>
          <p>Connected agents. Shared context. A little less firefighting.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api("/session", { code });
                await load();
              } catch (err: any) {
                setError(err.message);
              }
            }}
          >
            <label htmlFor="access-code">Demo access code</label>
            <input
              id="access-code"
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Enter your access code"
            />
            <button className="button primary">
              Enter workspace <ArrowRight size={16} />
            </button>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </form>
          <small>Local preview? Leave the code empty.</small>
        </div>
        <div className="login-art">
          <MemoryOrb />
          <h2>
            Every resolution
            <br />
            makes the next one better.
          </h2>
        </div>
      </div>
    );

  return (
    <div className="app-shell">
      {mobileNav && (
        <button
          className="nav-scrim"
          onClick={() => setMobileNav(false)}
          aria-label="Close navigation"
        />
      )}
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="sidebar-brand">
          <Logo />
          <span className="beta">BETA</span>
        </div>
        <div className="workspace-wrap">
          <button
            className="workspace-switch"
            onClick={() => setTenantOpen(!tenantOpen)}
            aria-expanded={tenantOpen}
          >
            <span
              className="workspace-avatar"
              style={{ background: state?.workspace.color }}
            >
              {state?.workspace.initials ?? "ac"}
            </span>
            <span>
              <strong>{state?.workspace.name ?? "Your workspace"}</strong>
              <small>
                Demo workspace <ChevronDown size={12} />
              </small>
            </span>
            <ChevronDown size={15} />
          </button>
          {tenantOpen && (
            <div className="tenant-menu">
              {state?.workspaces.map((w) => (
                <button key={w.id} onClick={() => void changeTenant(w.id)}>
                  <span
                    className="workspace-avatar"
                    style={{ background: w.color }}
                  >
                    {w.initials}
                  </span>
                  <span>{w.name}</span>
                  {state.workspace.id === w.id && <Check size={16} />}
                </button>
              ))}
              <p>
                <LockKeyhole size={12} /> Separate memory for each workspace
              </p>
            </div>
          )}
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {views.map((item) => (
            <button
              className={`nav-item ${view === item.id ? "active" : ""}`}
              key={item.id}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.id === "incidents" && active.length > 0 && (
                <span className="nav-count">{active.length}</span>
              )}
              {item.id === "memory" && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <div className="nav-label">RESOURCES</div>
        <button className="nav-item" onClick={() => setModal("guide")}>
          <BookOpen size={18} />
          <span>Demo playbook</span>
          <ArrowUpRight size={14} />
        </button>
        <div className="sidebar-bottom">
          <div className="memory-promise">
            <span className="promise-icon">
              <BrainCircuit size={21} />
            </span>
            <strong>Good work stays with you.</strong>
            <p>
              Your agents learn from every
              <br />
              incident they resolve.
            </p>
            <button onClick={() => navigate("memory")}>
              Explore shared memory <ArrowRight size={14} />
            </button>
            <div className="promise-decoration">✳</div>
          </div>
          <button
            className={`nav-item ${view === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={18} />
            <span>Settings & connections</span>
          </button>
          <div className="user-profile">
            <span className="user-avatar">R</span>
            <div>
              <strong>Rakesh</strong>
              <small>Workspace owner</small>
            </div>
            <span className="profile-online" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {view === "settings"
                ? "Settings & connections"
                : views.find((v) => v.id === view)?.label}
            </strong>
          </div>
          <div className="topbar-right">
            <span className={`sync-status ${offline ? "offline" : ""}`}>
              <i />
              {offline ? "Reconnecting…" : "Memory in sync"}
            </span>
            <span className="topbar-separator" />
            <button
              className="search-trigger"
              aria-label="Search workspace"
              onClick={() => setModal("search")}
            >
              <Search size={16} />
              <span>Search anything</span>
              <kbd>⌘ K</kbd>
            </button>
            <button
              className="icon-button help-top"
              aria-label="Open demo guide"
              onClick={() => setModal("guide")}
            >
              <CircleHelp size={19} />
            </button>
            <span className="top-avatar">R</span>
          </div>
        </header>
        {offline && (
          <div className="connection-banner" role="status">
            <RefreshCw size={15} /> Reconnecting to the server. Your saved work
            will appear when the connection returns.
            <button onClick={load}>Retry now</button>
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            <TriangleAlert size={16} />
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {!state ? (
          <main className="loading-state">
            <LoaderCircle className="spin" size={28} />
            <h2>Reconnecting the dots…</h2>
            <p>Loading your workspace and shared memory.</p>
          </main>
        ) : (
          <main className={`content view-${view}`}>
            {view === "overview" && (
              <>
                <div className="page-heading">
                  <div>
                    <p className="eyebrow">
                      <span className="little-sun">✳</span> YOUR OPERATIONS, IN
                      CONTEXT
                    </p>
                    <h1>A calmer kind of on-call.</h1>
                    <p>
                      Your agents are connected. Your context is never lost.
                    </p>
                  </div>
                  <button
                    className="button primary"
                    onClick={() => setModal("new")}
                  >
                    <Plus size={17} /> New incident
                  </button>
                </div>
                <div className="stats-grid">
                  <Stat
                    label="Open incidents"
                    value={active.length.toString().padStart(2, "0")}
                    icon={Activity}
                    foot={
                      active.length
                        ? "Ready for your agent team"
                        : "A clear horizon"
                    }
                    tint="peach"
                    extra={
                      <span className="tiny-pill neutral">
                        <Radio size={11} /> Live
                      </span>
                    }
                  />
                  <Stat
                    label="Memories retained"
                    value={memories
                      .filter((m) => m.status === "active")
                      .length.toString()
                      .padStart(2, "0")}
                    icon={BrainCircuit}
                    foot="Context that carries forward"
                    tint="green"
                    extra={
                      <span className="tiny-pill">
                        <GitBranch size={11} /> Connected
                      </span>
                    }
                  />
                  <Stat
                    label="Resolved incidents"
                    value={incidents
                      .filter((i) => i.status === "resolved")
                      .length.toString()
                      .padStart(2, "0")}
                    icon={CheckCheck}
                    foot="Verified recovery outcomes"
                    tint="blue"
                    extra={
                      <span className="tiny-pill neutral">
                        <Check size={11} /> Verified
                      </span>
                    }
                  />
                  <Stat
                    label="Agent handoffs"
                    value={state.edges
                      .filter((e) => e.relation === "HANDS_OFF_TO")
                      .length.toString()
                      .padStart(2, "0")}
                    icon={Workflow}
                    foot="Shared context at every step"
                    tint="purple"
                    extra={
                      <div className="avatar-stack">
                        {AGENTS.map((a) => (
                          <AgentAvatar key={a.id} id={a.id} />
                        ))}
                      </div>
                    }
                  />
                </div>
                <div className="workspace-layout">
                  <div className="main-column">
                    <div className="section-heading">
                      <h2>
                        Incident workspace{" "}
                        <span className="section-count">
                          {active.length} active
                        </span>
                      </h2>
                      <button
                        className="text-button"
                        onClick={() => navigate("incidents")}
                      >
                        View all incidents <ArrowRight size={14} />
                      </button>
                    </div>
                    {current ? (
                      <IncidentPanel
                        incident={current}
                        state={state}
                        busy={busy}
                        action={safeAction}
                        memoryClick={setMemoryDetail}
                        send={async (text) => {
                          await mutate(`/incidents/${current.id}/messages`, {
                            text,
                          });
                        }}
                      />
                    ) : (
                      <div className="panel">
                        <Empty
                          title="A clear horizon"
                          text="Start a simulated incident to see your agent team work together."
                          icon={ShieldCheck}
                        >
                          <button
                            className="button primary"
                            onClick={() => setModal("new")}
                          >
                            Create an incident <Plus size={16} />
                          </button>
                        </Empty>
                      </div>
                    )}
                    <div className="workspace-footnote">
                      <LockKeyhole size={12} />
                      <span>Private to {state.workspace.name}</span>
                      <span>·</span>
                      <span>State saved across sessions</span>
                      <span className="footnote-right">
                        <i />{" "}
                        {state.backend === "browser"
                          ? "Browser demo"
                          : state.backend === "sqlite"
                            ? "Local preview"
                            : "FalkorDB connected"}
                      </span>
                    </div>
                  </div>
                  <aside className="context-column">
                    <section
                      className="context-section"
                      aria-label="Your agent team"
                    >
                      <div className="section-heading">
                        <h2>Your agent team</h2>
                        <span className="small-label">3 specialists</span>
                      </div>
                      <div className="panel team-panel">
                        {AGENTS.map((a) => {
                          const running = nodes.find(
                            (n) =>
                              n.kind === "task" &&
                              n.agent === a.id &&
                              n.status === "running" &&
                              n.leaseUntil > Date.now(),
                          );
                          return (
                            <button
                              className="team-row"
                              key={a.id}
                              onClick={() => navigate("agents")}
                            >
                              <AgentAvatar id={a.id} />
                              <div>
                                <strong>
                                  {a.name}
                                  <span>{a.role}</span>
                                </strong>
                                <small>
                                  {running
                                    ? "Working on an incident"
                                    : a.description}
                                </small>
                              </div>
                              <span
                                className={`agent-presence ${running ? "working" : ""}`}
                              />
                            </button>
                          );
                        })}
                        <div className="team-footer">
                          <Workflow size={13} /> One shared memory. Zero lost
                          handoffs.
                        </div>
                      </div>
                    </section>
                    <section
                      className="context-section"
                      aria-label="Relevant memories"
                    >
                      <div className="section-heading memory-section-heading">
                        <h2>Relevant memories</h2>
                        <button
                          className="text-button"
                          onClick={() => navigate("memory")}
                          aria-label="View all memories"
                        >
                          <ArrowUpRight size={16} />
                        </button>
                      </div>
                      <div className="panel context-memories">
                        {memories
                          .filter((m) => m.status === "active")
                          .slice(0, 3)
                          .map((m) => (
                            <button
                              className="context-memory"
                              key={m.id}
                              onClick={() => setMemoryDetail(m)}
                            >
                              <div className="memory-card-top">
                                <MemoryIcon category={m.category} />
                                <span
                                  className={`category-label ${m.category}`}
                                >
                                  {m.category}
                                </span>
                                <ArrowUpRight size={13} />
                              </div>
                              <strong>{m.title}</strong>
                              <p>{m.source}</p>
                            </button>
                          ))}
                        <button
                          className="memory-view-all"
                          onClick={() => navigate("memory")}
                        >
                          Explore memory graph <Network size={14} />
                        </button>
                      </div>
                    </section>
                    <div className="context-promo">
                      <div className="promo-top">
                        <span className="promo-dot" /> BUILT TO REMEMBER
                      </div>
                      <MemoryOrb compact />
                      <h3>
                        The next incident
                        <br />
                        starts a step ahead.
                      </h3>
                      <p>
                        Every discovery becomes context.
                        <br />
                        Every resolution makes your team better.
                      </p>
                      <button onClick={() => setModal("guide")}>
                        See how it works <ArrowUpRight size={14} />
                      </button>
                    </div>
                  </aside>
                </div>
              </>
            )}
            {view === "incidents" && (
              <IncidentList
                incidents={incidents}
                open={openIncident}
                create={() => setModal("new")}
              />
            )}
            {view === "memory" && (
              <MemoryPage
                state={state}
                memories={memories}
                select={setMemoryDetail}
              />
            )}
            {view === "agents" && (
              <AgentPage state={state} open={openIncident} />
            )}
            {view === "settings" && (
              <SettingsPage
                state={state}
                guide={() => setModal("guide")}
                refresh={load}
              />
            )}
            <footer className="page-footer">
              <span>
                relayops <i>·</i> A team that remembers.
              </span>
              <span>
                <span className="demo-dot" />{" "}
                {state.backend === "browser"
                  ? "Browser demo · saved on this device"
                  : state.model === "simulation"
                    ? "Simulation mode"
                    : `${state.model === "openai" ? "OpenAI" : "Claude"} · sandbox workflow`}
                <span className="footer-build">v0.1 / prototype</span>
              </span>
            </footer>
          </main>
        )}
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {modal === "new" && (
        <NewIncidentModal
          close={() => setModal(null)}
          busy={busy}
          create={async (data) => {
            const incident = await mutate(
              "/incidents",
              data,
              "Incident created. Your team is ready.",
            );
            setSelected(incident.id);
            setView("overview");
            setModal(null);
          }}
        />
      )}
      {modal === "search" && (
        <SearchModal
          state={state}
          close={() => setModal(null)}
          open={openIncident}
          memory={(m) => {
            setModal(null);
            setMemoryDetail(m);
          }}
        />
      )}
      {modal === "guide" && (
        <GuideModal
          close={() => setModal(null)}
          start={() => {
            setModal("new");
          }}
        />
      )}
      {memoryDetail && (
        <MemoryModal
          memory={
            state?.nodes.find((n) => n.id === memoryDetail.id) ?? memoryDetail
          }
          nodes={nodes}
          close={() => setMemoryDetail(null)}
          select={setMemoryDetail}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  foot,
  tint,
  extra,
}: {
  label: string;
  value: string;
  icon: typeof Activity;
  foot: string;
  tint: string;
  extra: ReactNode;
}) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <span className={`stat-icon ${tint}`}>
          <Icon size={16} />
        </span>
      </div>
      <div className="stat-value">
        <strong>{value}</strong>
        {extra}
      </div>
      <p>{foot}</p>
    </div>
  );
}

function IncidentPanel({
  incident,
  state,
  action,
  busy,
  memoryClick,
  send,
}: {
  incident: Entity;
  state: Snapshot;
  action: (id: string, action: string) => void;
  busy: boolean;
  memoryClick: (m: Entity) => void;
  send: (text: string) => Promise<void>;
}) {
  const [tab, setTab] = useState("timeline");
  const [text, setText] = useState("");
  const events = state.nodes
    .filter((n) => n.kind === "event" && n.incidentId === incident.id)
    .sort((a, b) => a.createdAt - b.createdAt);
  const messages = state.nodes
    .filter((n) => n.kind === "message" && n.incidentId === incident.id)
    .sort((a, b) => a.createdAt - b.createdAt);
  const running = state.nodes.find(
    (n) =>
      n.kind === "task" &&
      n.incidentId === incident.id &&
      n.status === "running" &&
      n.leaseUntil > Date.now(),
  );
  const roleProgress = [
    incident.status === "resolved" || incident.stage > 0,
    incident.status === "resolved" || incident.stage > 2,
    incident.status === "resolved" || incident.stage >= 4,
  ];
  const evidence = events.filter((e) => e.evidence?.length);
  useEffect(() => {
    setText("");
    setTab("timeline");
  }, [incident.id]);
  return (
    <section className="panel incident-panel">
      <div className="incident-top">
        <div className="incident-meta">
          <span className="incident-number">{incident.number}</span>
          <span className={`severity ${incident.severity}`}>
            {incident.severity}{" "}
            <span>
              {incident.severity === "P1"
                ? "High"
                : incident.severity === "P2"
                  ? "Medium"
                  : "Low"}
            </span>
          </span>
          <Badge status={incident.status} />
          <span className="incident-time">
            <Clock3 size={12} />
            {relative(incident.createdAt)}
          </span>
        </div>
        <h2>{incident.title}</h2>
        <div className="incident-subline">
          <span>
            <Box size={13} />
            {incident.service}
          </span>
          <span className="meta-dot">·</span>
          <span>
            <Globe2 size={13} />
            us-east-1
          </span>
          <span className="environment-label">Simulated environment</span>
        </div>
        <div className="incident-description">{incident.description}</div>
        <div className="incident-actions">
          {incident.status === "open" && (
            <button
              className="button primary small"
              disabled={busy}
              onClick={() => action(incident.id, "start")}
            >
              <Play size={14} /> Start investigation
            </button>
          )}
          {["investigating", "resolving"].includes(incident.status) && (
            <button
              className="button secondary small"
              disabled={busy}
              onClick={() => action(incident.id, "pause")}
            >
              <Pause size={14} /> Pause investigation
            </button>
          )}
          {["paused", "error"].includes(incident.status) && (
            <button
              className="button primary small"
              disabled={busy}
              onClick={() => action(incident.id, "resume")}
            >
              <Play size={14} /> Resume from checkpoint
            </button>
          )}
          {incident.status === "awaiting_approval" && (
            <button
              className="button primary small"
              disabled={busy}
              onClick={() => action(incident.id, "approve")}
            >
              <Check size={14} /> Approve & resolve
            </button>
          )}
          {incident.status === "resolved" && (
            <span className="resolved-message">
              <ShieldCheck size={16} /> Recovery verified and saved to memory
            </span>
          )}
          {["open", "paused", "awaiting_approval", "error"].includes(
            incident.status,
          ) && (
            <button
              className="button ghost small"
              disabled={busy}
              onClick={() => action(incident.id, "migrate")}
              title="Simulate a database migration and correct the shared memory"
            >
              <GitCompareArrows size={14} /> Introduce new evidence
            </button>
          )}
        </div>
      </div>
      <div className="agent-flow">
        {AGENTS.map((a, i) => (
          <div className="flow-wrapper" key={a.id}>
            <div
              className={`flow-step ${running?.agent === a.id ? "working" : ""} ${roleProgress[i] ? "complete" : ""}`}
            >
              <AgentAvatar id={a.id} />
              <div>
                <strong>
                  {a.name}
                  <span>{a.role}</span>
                </strong>
                <small>
                  {roleProgress[i] ? (
                    <>
                      <Check size={11} /> Complete
                    </>
                  ) : running?.agent === a.id ? (
                    <>
                      <span className="thinking-dots">
                        <i />
                        <i />
                        <i />
                      </span>{" "}
                      Working
                    </>
                  ) : i === 1 && incident.status === "awaiting_approval" ? (
                    "Awaiting approval"
                  ) : (
                    "Ready when needed"
                  )}
                </small>
              </div>
            </div>
            {i < 2 && <ArrowRight className="flow-arrow" size={15} />}
          </div>
        ))}
      </div>
      <div className="incident-tabs">
        <div>
          {[
            { id: "timeline", name: "Live timeline", icon: Activity },
            { id: "conversation", name: "Conversation", icon: MessageSquare },
            { id: "evidence", name: "Evidence", icon: FileText },
          ].map((t) => (
            <button
              className={tab === t.id ? "active" : ""}
              key={t.id}
              onClick={() => setTab(t.id)}
            >
              <t.icon size={14} />
              {t.name}
              {t.id === "timeline" && <span>{events.length}</span>}
            </button>
          ))}
        </div>
        <span className="saved-label">
          <CheckCheck size={13} /> Saved
        </span>
      </div>
      {tab === "timeline" && (
        <div className="timeline">
          <div className="timeline-date">
            <span>
              {new Date(incident.createdAt).toLocaleDateString([], {
                month: "long",
                day: "numeric",
              })}
            </span>
            <span>ALL TIMES LOCAL</span>
          </div>
          {events.map((event, index) => (
            <div className={`timeline-event ${event.type}`} key={event.id}>
              <div className="timeline-gutter">
                <AgentAvatar id={event.agent} />
                {index !== events.length - 1 && <span />}
              </div>
              <div className="timeline-content">
                <div className="timeline-author">
                  <strong>
                    {agentBy(event.agent)?.name ??
                      (event.agent === "you" ? "You" : "RelayOps")}
                    <span>
                      {agentBy(event.agent)?.role ??
                        (event.agent === "you" ? "Operator" : "Monitor")}
                    </span>
                  </strong>
                  <time>{timestamp(event.createdAt)}</time>
                </div>
                <h4>{event.title}</h4>
                <p>{event.content}</p>
                {event.memoryIds?.length > 0 && (
                  <div className="memory-citations">
                    {event.memoryIds.slice(0, 3).map((id: string) => {
                      const m = state.nodes.find((n) => n.id === id);
                      return m ? (
                        <button key={id} onClick={() => memoryClick(m)}>
                          <MemoryIcon category={m.category} />
                          <span>{m.title}</span>
                          <ArrowUpRight size={11} />
                        </button>
                      ) : null;
                    })}
                  </div>
                )}
                {event.evidence && (
                  <div className="inline-evidence">
                    {event.evidence.map((e: string) => (
                      <code key={e}>{e}</code>
                    ))}
                  </div>
                )}
                {event.traces?.length > 0 && (
                  <TraceList
                    traces={event.traces}
                    nodes={state.nodes}
                    simulated={event.simulated}
                  />
                )}
              </div>
            </div>
          ))}
          {incident.status === "open" && (
            <div className="ready-context">
              <span className="ready-context-icon">
                <BrainCircuit size={22} />
              </span>
              <div>
                <strong>Your team has a head start.</strong>
                <p>
                  Past incidents, service knowledge, and a verified runbook are
                  connected and ready.
                </p>
                <span>
                  <Check size={12} /> Shared context loaded <span>·</span>{" "}
                  <LockKeyhole size={11} /> Workspace isolated
                </span>
              </div>
              <Network className="ready-network" size={58} />
            </div>
          )}
          {running && (
            <div className="thinking-row">
              <span className="thinking-dots">
                <i />
                <i />
                <i />
              </span>
              {agentBy(running.agent)?.name} is working with shared context…
            </div>
          )}
          {incident.status === "paused" && (
            <div className="checkpoint-note">
              <Pause size={16} />
              <div>
                <strong>Nothing gets lost here.</strong>
                <p>
                  You can close this window. Your team will resume from this
                  checkpoint.
                </p>
              </div>
            </div>
          )}
          {incident.error && <div className="form-error">{incident.error}</div>}
        </div>
      )}
      {tab === "conversation" && (
        <div className="conversation">
          {messages.length === 0 && (
            <div className="conversation-intro">
              <span>
                <MessageSquare size={22} />
              </span>
              <h3>Ask with all the context.</h3>
              <p>
                Atlas can recall this workspace’s service facts and past
                outcomes.
              </p>
              <div>
                {[
                  "What happened last time?",
                  "Why not restart the service?",
                  "Who should I page?",
                  "What else breaks if the database goes down?",
                ].map((q) => (
                  <button key={q} onClick={() => setText(q)}>
                    {q}
                    <ArrowUpRight size={13} />
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div className={`message ${m.role}`} key={m.id}>
              <strong>
                {m.role === "user" ? "You" : "Atlas"}
                <time>{timestamp(m.createdAt)}</time>
              </strong>
              <p>{m.content}</p>
              {m.traces?.length > 0 ? (
                <TraceList traces={m.traces} nodes={state.nodes} />
              ) : (
                m.memoryIds?.length > 0 && (
                  <small>
                    <BrainCircuit size={12} /> Based on {m.memoryIds.length}{" "}
                    linked memories
                  </small>
                )
              )}
            </div>
          ))}
          <form
            className="composer"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!text.trim()) return;
              try {
                await send(text);
                setText("");
              } catch {}
            }}
          >
            <input
              aria-label="Ask your agent team"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Ask your team anything about this incident…"
              maxLength={2000}
            />
            <button
              type="submit"
              aria-label="Send message"
              disabled={busy || !text.trim()}
            >
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <ArrowUpRight size={18} />
              )}
            </button>
          </form>
          <div className="conversation-hint">
            <LockKeyhole size={11} /> Conversation history is saved in your
            workspace.
          </div>
        </div>
      )}
      {tab === "evidence" && (
        <div className="evidence-tab">
          {evidence.length === 0 ? (
            <Empty
              icon={FileText}
              title="Evidence follows the investigation"
              text="Start the investigation to collect simulated telemetry and trace it back to shared memory."
            />
          ) : (
            evidence.map((event) => (
              <div className="evidence-card" key={event.id}>
                <div>
                  <Terminal size={16} />
                  <strong>{event.title}</strong>
                  <span>Sandbox telemetry</span>
                </div>
                {event.evidence.map((line: string) => (
                  <code key={line}>{line}</code>
                ))}
                <small>
                  Collected by {agentBy(event.agent)?.name} ·{" "}
                  {timestamp(event.createdAt)}
                </small>
              </div>
            ))
          )}
        </div>
      )}
      {incident.investigation && incident.status !== "resolved" && (
        <div className="plan-review investigation-card">
          <div className="plan-label">
            <Waypoints size={15} />
            <strong>
              Root cause: {incident.investigation.rootCauseService}
            </strong>
            <span>
              {incident.investigation.toolCalls} graph queries ·{" "}
              {incident.investigation.ruledOut?.length ?? 0} ruled out ·{" "}
              {incident.investigation.impactedServiceIds?.length ?? 0}{" "}
              downstream
            </span>
          </div>
          {incident.investigation.escalateTo && (
            <div className="plan-details">
              <span>
                Escalate to{" "}
                <strong>
                  {nodeLabel(
                    state.nodes.find(
                      (n) => n.id === incident.investigation.escalateTo,
                    ),
                    incident.investigation.escalateTo,
                  )}
                </strong>
              </span>
            </div>
          )}
        </div>
      )}
      {incident.plan && incident.status !== "resolved" && (
        <div className="plan-review">
          <div className="plan-label">
            <GitBranch size={15} />
            <strong>Proposed recovery</strong>
            <span>
              {nodeLabel(
                state.nodes.find((n) => n.id === incident.plan.procedureId),
                incident.plan.procedureId,
              )}
            </span>
          </div>
          <div className="plan-details">
            <code>{incident.plan.database}</code>
            <ArrowRight size={13} />
            <span>
              {incident.plan.action === "increase-pool" ? (
                <>
                  Pool capacity <strong>{incident.plan.targetPool}</strong>
                </>
              ) : (
                <strong>{incident.plan.action}</strong>
              )}
            </span>
            {incident.plan.forbidden?.length > 0 && (
              <span className="plan-forbidden">
                <TriangleAlert size={13} /> Will not{" "}
                {incident.plan.forbidden.join(", ")}
              </span>
            )}
            <span className="plan-check">
              <ShieldCheck size={13} /> Verify before closing
            </span>
          </div>
        </div>
      )}
      <div className="incident-bottom">
        <span>
          <Database size={13} /> Persisted across sessions
        </span>
        <span>
          <GitBranch size={13} /> {incident.memoryReused || 0} memories recalled
        </span>
        <span>
          <ShieldCheck size={13} /> Auditable actions
        </span>
      </div>
    </section>
  );
}

function MemoryOrb({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`memory-orb ${compact ? "compact" : ""}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 260 170">
        <defs>
          <radialGradient id={compact ? "glow-sm" : "glow-lg"}>
            <stop stopColor="#b7d78d" stopOpacity=".19" />
            <stop offset="1" stopColor="#b7d78d" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse
          cx="130"
          cy="87"
          rx="113"
          ry="80"
          fill={`url(#${compact ? "glow-sm" : "glow-lg"})`}
        />
        <g stroke="#97b89f" fill="none">
          <ellipse
            cx="130"
            cy="87"
            rx="89"
            ry="53"
            opacity=".22"
            transform="rotate(-24 130 87)"
          />
          <ellipse
            cx="130"
            cy="87"
            rx="89"
            ry="53"
            opacity=".22"
            transform="rotate(24 130 87)"
          />
          <ellipse cx="130" cy="87" rx="40" ry="67" opacity=".25" />
          <path
            d="M55 63 130 86 200 58M130 86 94 135M130 86 192 120M130 86 120 20"
            strokeDasharray="3 4"
            opacity=".4"
          />
        </g>
        <g>
          <circle cx="55" cy="63" r="14" fill="#294c3d" stroke="#6b9475" />
          <circle cx="200" cy="58" r="11" fill="#294c3d" stroke="#6b9475" />
          <circle cx="94" cy="135" r="10" fill="#294c3d" stroke="#6b9475" />
          <circle cx="192" cy="120" r="5" fill="#c9df9f" />
          <circle cx="120" cy="20" r="4" fill="#719b75" />
          <circle cx="130" cy="86" r="23" fill="#c5dc9f" />
          <path
            d="M123 94V78h9a6 6 0 0 1 0 12h-3M132 84h9m-3-3 3 3-3 3"
            stroke="#274c38"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="m50 63 4 4 6-7"
            stroke="#c5dc9f"
            fill="none"
            strokeWidth="2"
          />
          <circle cx="200" cy="58" r="3" fill="#c5dc9f" />
        </g>
      </svg>
    </div>
  );
}

function IncidentList({
  incidents,
  open,
  create,
}: {
  incidents: Entity[];
  open: (id: string) => void;
  create: () => void;
}) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const filtered = incidents.filter(
    (i) =>
      (filter === "all" ||
        (filter === "resolved"
          ? i.status === "resolved"
          : i.status !== "resolved")) &&
      `${i.title} ${i.number} ${i.service}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">NOTHING FALLS THROUGH THE CRACKS</p>
          <h1>Every incident. In context.</h1>
          <p>Follow the work, from the first signal to a verified recovery.</p>
        </div>
        <button className="button primary" onClick={create}>
          <Plus size={17} /> New incident
        </button>
      </div>
      <div className="panel incident-list">
        <div className="list-toolbar">
          <div className="segmented">
            {["all", "open", "resolved"].map((f) => (
              <button
                className={filter === f ? "active" : ""}
                onClick={() => setFilter(f)}
                key={f}
              >
                {f === "all"
                  ? "All incidents"
                  : f[0].toUpperCase() + f.slice(1)}{" "}
                <span>
                  {
                    incidents.filter(
                      (i) =>
                        f === "all" ||
                        (f === "resolved"
                          ? i.status === "resolved"
                          : i.status !== "resolved"),
                    ).length
                  }
                </span>
              </button>
            ))}
          </div>
          <div className="input-with-icon">
            <Search size={15} />
            <input
              aria-label="Search incidents"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search incidents…"
            />
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Incident</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Service</th>
                <th>Opened</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id} onClick={() => open(i.id)}>
                  <td>
                    <button
                      className="table-title"
                      onClick={(e) => {
                        e.stopPropagation();
                        open(i.id);
                      }}
                    >
                      <small>{i.number}</small>
                      <strong>{i.title}</strong>
                    </button>
                  </td>
                  <td>
                    <span className={`severity ${i.severity}`}>
                      {i.severity}
                    </span>
                  </td>
                  <td>
                    <Badge status={i.status} />
                  </td>
                  <td>
                    <span className="service-tag">
                      <Box size={12} />
                      {i.service}
                    </span>
                  </td>
                  <td className="muted">{relative(i.createdAt)}</td>
                  <td>
                    <ChevronRight size={16} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length && (
          <Empty
            title="No incidents match"
            text="Try another search, or create a new incident."
          />
        )}
      </div>
    </>
  );
}

function MemoryPage({
  state,
  memories,
  select,
}: {
  state: Snapshot;
  memories: Entity[];
  select: (m: Entity) => void;
}) {
  const [category, setCategory] = useState("all");
  const [display, setDisplay] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 760px)").matches
      ? "list"
      : "graph",
  );
  const [query, setQuery] = useState("");
  const filtered = memories.filter(
    (m) =>
      (category === "all" || m.category === category) &&
      `${m.title} ${m.content}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CONTEXT THAT COMPOUNDS</p>
          <h1>Your team’s collective memory.</h1>
          <p>What happened, what’s true, and what to do next. All connected.</p>
        </div>
        <a className="button secondary" href="/api/export" download>
          <Download size={16} /> Export memory
        </a>
      </div>
      <div className="memory-summary">
        <div>
          <MemoryIcon category="episodic" />
          <strong>
            {memories.filter((m) => m.category === "episodic").length}
          </strong>
          <span>Experiences remembered</span>
        </div>
        <div>
          <MemoryIcon category="semantic" />
          <strong>
            {memories.filter((m) => m.category === "semantic").length}
          </strong>
          <span>Facts connected</span>
        </div>
        <div>
          <MemoryIcon category="procedural" />
          <strong>
            {memories.filter((m) => m.category === "procedural").length}
          </strong>
          <span>Procedures retained</span>
        </div>
        <div>
          <LockKeyhole size={16} />
          <span>
            Private to <strong>{state.workspace.name}</strong>
          </span>
        </div>
      </div>
      <div className="panel memory-main">
        <div className="list-toolbar">
          <div className="segmented">
            <button
              className={display === "graph" ? "active" : ""}
              onClick={() => setDisplay("graph")}
            >
              <Network size={14} /> Graph view
            </button>
            <button
              className={display === "list" ? "active" : ""}
              onClick={() => setDisplay("list")}
            >
              <ListFilter size={14} /> Memory library
            </button>
          </div>
          <div className="input-with-icon">
            <Search size={15} />
            <input
              aria-label="Search memories"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a memory…"
            />
          </div>
        </div>
        <div className="category-filters">
          {["all", "episodic", "semantic", "procedural"].map((c) => (
            <button
              className={category === c ? "active" : ""}
              key={c}
              onClick={() => setCategory(c)}
            >
              {c === "all" ? (
                "All memories"
              ) : (
                <>
                  <MemoryIcon category={c} />
                  {c[0].toUpperCase() + c.slice(1)}
                </>
              )}
            </button>
          ))}
          <span>
            <i /> Live workspace state
          </span>
        </div>
        {display === "graph" ? (
          <MemoryGraph state={state} memories={filtered} select={select} />
        ) : (
          <div className="memory-library">
            {filtered.map((m) => (
              <button
                className={`library-card ${m.status}`}
                onClick={() => select(m)}
                key={m.id}
              >
                <div>
                  <MemoryIcon category={m.category} />
                  <span className={`category-label ${m.category}`}>
                    {m.category}
                  </span>
                  <span className="memory-version">v{m.version}</span>
                </div>
                <h3>{m.title}</h3>
                <p>{m.content}</p>
                <footer>
                  <span>
                    {m.status === "superseded"
                      ? "Superseded · history preserved"
                      : m.source}
                  </span>
                  <ArrowUpRight size={14} />
                </footer>
              </button>
            ))}
            {!filtered.length && (
              <Empty
                title="No memories found"
                text="Try a different search or memory type."
              />
            )}
          </div>
        )}
        <div className="memory-legend">
          <span>
            <i className="legend-semantic" /> Semantic · facts
          </span>
          <span>
            <i className="legend-episodic" /> Episodic · experiences
          </span>
          <span>
            <i className="legend-procedural" /> Procedural · how-to
          </span>
          <span>
            Click a memory to trace its source <ArrowUpRight size={12} />
          </span>
        </div>
      </div>
    </>
  );
}

function MemoryGraph({
  state,
  memories,
  select,
}: {
  state: Snapshot;
  memories: Entity[];
  select: (m: Entity) => void;
}) {
  const [focus, setFocus] = useState<string | null>(null);
  const [showWorkflow, setShowWorkflow] = useState(false);
  const byId = new Map(state.nodes.map((n) => [n.id, n]));
  const visibleMemory = new Set(memories.map((m) => m.id));
  const WORKFLOW = new Set(["event", "task", "message"]);
  const nodes = state.nodes.filter(
    (n) =>
      !WORKFLOW.has(n.kind) &&
      (n.kind !== "memory" || visibleMemory.has(n.id)) &&
      (n.kind !== "incident" || n.status === "resolved" || showWorkflow),
  );
  const shown = new Set(nodes.map((n) => n.id));
  const edges = state.edges.filter(
    (e) =>
      shown.has(e.from) &&
      shown.has(e.to) &&
      !["HAS_EVENT", "HAS_TASK", "HAS_MESSAGE"].includes(e.relation),
  );

  // Highlight: union of every trace path on the most recent finding/plan events,
  // or the neighbourhood of a focused node.
  const latest = [...state.nodes]
    .filter((n) => n.kind === "event" && n.traces?.length)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  const hot = new Set<string>();
  const hotEdges = new Set<string>();
  if (focus) {
    hot.add(focus);
    for (const e of edges)
      if (e.from === focus || e.to === focus) {
        hot.add(e.from);
        hot.add(e.to);
        hotEdges.add(`${e.from}|${e.relation}|${e.to}`);
      }
  } else if (latest) {
    for (const t of latest.traces as ToolTrace[]) {
      for (const id of t.nodeIds) hot.add(id);
      for (const p of t.paths ?? []) {
        hot.add(p.from);
        hot.add(p.to);
        hotEdges.add(
          `${p.from}|${p.relation.replace(" (shared)", "")}|${p.to}`,
        );
      }
    }
    if (latest.incidentId) hot.add(latest.incidentId);
  }

  // Layered layout by kind: people/teams left, topology centre, incidents/memory/decisions right.
  const columns: Array<{ kinds: string[]; x: number; title: string }> = [
    { kinds: ["person"], x: 90, title: "PEOPLE" },
    { kinds: ["team"], x: 300, title: "TEAMS" },
    { kinds: ["service"], x: 560, title: "SERVICES" },
    { kinds: ["incident"], x: 830, title: "INCIDENTS" },
    { kinds: ["memory"], x: 1080, title: "MEMORY" },
    { kinds: ["decision"], x: 1330, title: "DECISIONS" },
  ];
  const ROW = 44;
  const positions = new Map<string, { x: number; y: number }>();
  let height = 120;
  for (const col of columns) {
    const items = nodes
      .filter((n) => col.kinds.includes(n.kind))
      .sort((a, b) => {
        if (a.kind === "service") {
          // keep call order roughly top to bottom: edge, core, data
          const rank = (n: Entity) =>
            n.tier === "edge"
              ? 0
              : n.type === "database" || n.type === "index"
                ? 3
                : n.type === "external"
                  ? 4
                  : 1;
          return rank(a) - rank(b) || a.name.localeCompare(b.name);
        }
        if (a.kind === "memory")
          return (
            (a.serviceId ?? "").localeCompare(b.serviceId ?? "") ||
            a.createdAt - b.createdAt
          );
        return (a.name ?? a.number ?? a.title ?? "").localeCompare(
          b.name ?? b.number ?? b.title ?? "",
        );
      });
    items.forEach((n, i) => positions.set(n.id, { x: col.x, y: 70 + i * ROW }));
    height = Math.max(height, 70 + items.length * ROW + 40);
  }
  const width = 1480;
  const color = (n: Entity) =>
    n.kind === "service"
      ? n.type === "database" || n.type === "index"
        ? "#204e3e"
        : "#3b7a5c"
      : n.kind === "person"
        ? "#5675ca"
        : n.kind === "team"
          ? "#7b8fcf"
          : n.kind === "incident"
            ? n.status === "resolved"
              ? "#c39149"
              : "#d2553a"
            : n.kind === "decision"
              ? n.status === "rejected"
                ? "#b65a4a"
                : "#8a7a4a"
              : n.category === "semantic"
                ? "#a088b6"
                : n.category === "episodic"
                  ? "#d19d64"
                  : "#6c9b7e";
  const label = (n: Entity) => {
    const text = n.name ?? n.number ?? n.title ?? n.id;
    return text.length > 28 ? `${text.slice(0, 27)}…` : text;
  };
  const dim = hot.size > 0;
  return (
    <div className="graph-canvas">
      <div className="graph-title">
        <span>
          <GitBranch size={14} /> {state.workspace.name}
        </span>
        <small>
          {nodes.length} nodes · {edges.length} relationships
          {latest && !focus ? ` · highlighting ${latest.title}` : ""}
          {focus ? ` · ${label(byId.get(focus)!)}` : ""}
        </small>
        {focus && (
          <button className="link" onClick={() => setFocus(null)}>
            Clear
          </button>
        )}
      </div>
      <div
        className="graph-viewport"
        role="region"
        aria-label="Scrollable workspace graph"
        tabIndex={0}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label="Workspace knowledge graph"
        >
          <defs>
            <pattern
              id="dots"
              x="0"
              y="0"
              width="18"
              height="18"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="1" cy="1" r=".8" fill="#d6ddd6" />
            </pattern>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="#9fb3a6" />
            </marker>
            <marker
              id="arrow-hot"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="#d2553a" />
            </marker>
          </defs>
          <rect width={width} height={height} fill="url(#dots)" />
          {columns.map((c) => (
            <text
              key={c.title}
              x={c.x}
              y={40}
              textAnchor="middle"
              className="graph-category"
            >
              {c.title}
            </text>
          ))}
          {edges.map((e, i) => {
            const a = positions.get(e.from);
            const b = positions.get(e.to);
            if (!a || !b) return null;
            const isHot = hotEdges.has(`${e.from}|${e.relation}|${e.to}`);
            const dx = b.x - a.x;
            const sameCol = Math.abs(dx) < 1;
            const x1 = a.x + (dx > 0 ? 70 : dx < 0 ? -70 : 0);
            const x2 = b.x + (dx > 0 ? -74 : dx < 0 ? 74 : 0);
            const d = sameCol
              ? `M${a.x + 70},${a.y} C${a.x + 130},${a.y} ${b.x + 130},${b.y} ${b.x + 70},${b.y}`
              : `M${x1},${a.y} C${(x1 + x2) / 2},${a.y} ${(x1 + x2) / 2},${b.y} ${x2},${b.y}`;
            return (
              <path
                key={i}
                d={d}
                fill="none"
                stroke={isHot ? "#d2553a" : "#b7cbbd"}
                strokeWidth={isHot ? 2.2 : 1}
                opacity={dim && !isHot ? 0.18 : 1}
                markerEnd={isHot ? "url(#arrow-hot)" : "url(#arrow)"}
              >
                <title>
                  {label(byId.get(e.from)!)} {e.relation}{" "}
                  {label(byId.get(e.to)!)}
                </title>
              </path>
            );
          })}
          {nodes.map((n) => {
            const p = positions.get(n.id);
            if (!p) return null;
            const isHot = hot.has(n.id);
            const superseded = n.status === "superseded";
            return (
              <g
                className="graph-node"
                key={n.id}
                role="button"
                tabIndex={0}
                aria-label={label(n)}
                opacity={dim && !isHot ? 0.35 : 1}
                onClick={() =>
                  n.kind === "memory"
                    ? select(n)
                    : setFocus(focus === n.id ? null : n.id)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    n.kind === "memory" ? select(n) : setFocus(n.id);
                  }
                }}
              >
                <title>
                  {n.kind}: {n.name ?? n.number ?? n.title}
                </title>
                <rect
                  x={p.x - 70}
                  y={p.y - 16}
                  width="140"
                  height="32"
                  rx="9"
                  fill="#fff"
                  stroke={
                    isHot ? "#d2553a" : superseded ? "#c8bda9" : "#dce3db"
                  }
                  strokeWidth={isHot ? 2 : 1}
                  strokeDasharray={superseded ? "4 3" : undefined}
                />
                <circle cx={p.x - 56} cy={p.y} r="4.5" fill={color(n)} />
                <text x={p.x - 46} y={p.y + 4} fontSize="11.5" fill="#1f2d27">
                  {label(n)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="graph-instruction">
        <span>
          <LockKeyhole size={12} /> Tenant-isolated graph
        </span>
        <span>
          Select a service, person, or incident to see its connections ·
          memories open their source
        </span>
        <label className="graph-toggle">
          <input
            type="checkbox"
            checked={showWorkflow}
            onChange={(e) => setShowWorkflow(e.target.checked)}
          />
          <span>Include open incidents</span>
        </label>
      </div>
    </div>
  );
}

function AgentPage({
  state,
  open,
}: {
  state: Snapshot;
  open: (id: string) => void;
}) {
  const tasks = state.nodes.filter((n) => n.kind === "task");
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">SPECIALISTS, WORKING TOGETHER</p>
          <h1>Meet your incident team.</h1>
          <p>
            Different strengths. One shared memory. A clear handoff at every
            step.
          </p>
        </div>
        <span className="button secondary static-label">
          <span className="live-dot" />{" "}
          {state.model === "simulation"
            ? "Simulation mode"
            : `${state.model === "openai" ? "OpenAI" : "Claude"} configured`}
        </span>
      </div>
      <div className="agent-cards">
        {AGENTS.map((a) => {
          const mine = tasks.filter((t) => t.agent === a.id);
          const running = mine.find(
            (t) => t.status === "running" && t.leaseUntil > Date.now(),
          );
          return (
            <div className="panel agent-card" key={a.id}>
              <div className="agent-card-header">
                <AgentAvatar id={a.id} size="large" />
                <span
                  className={`badge ${running ? "status-investigating" : "status-resolved"}`}
                >
                  <i />
                  {running ? "Working" : "Available"}
                </span>
              </div>
              <h2>
                {a.name}
                <span>{a.role}</span>
              </h2>
              <p>{a.description}</p>
              <div className="agent-capabilities">
                {(a.id === "atlas"
                  ? [
                      "Follow service dependencies",
                      "Recall past incident outcomes",
                      "Cite evidence and sources",
                    ]
                  : a.id === "sage"
                    ? [
                        "Retrieve verified procedures",
                        "Detect outdated recovery plans",
                        "Apply approved sandbox changes",
                      ]
                    : [
                        "Check error rate and latency",
                        "Record verified outcomes",
                        "Update procedure history",
                      ]
                ).map((c) => (
                  <span key={c}>
                    <Check size={13} />
                    {c}
                  </span>
                ))}
              </div>
              <div className="agent-card-stats">
                <div>
                  <strong>
                    {mine.filter((t) => t.status === "done").length}
                  </strong>
                  <span>Tasks completed</span>
                </div>
                <div>
                  <strong>
                    {
                      state.nodes.filter(
                        (n) => n.kind === "memory" && n.agent === a.id,
                      ).length
                    }
                  </strong>
                  <span>Memories contributed</span>
                </div>
              </div>
              <div className="agent-card-footer">
                <Database size={13} /> Reads and writes shared workspace memory
              </div>
            </div>
          );
        })}
      </div>
      <div className="panel handoff-panel">
        <div className="panel-heading">
          <h2>Handoff ledger</h2>
          <span className="small-label">Durable task checkpoints</span>
        </div>
        {tasks.length ? (
          tasks
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 15)
            .map((t) => (
              <button
                className="handoff-row"
                key={t.id}
                onClick={() => open(t.incidentId)}
              >
                <AgentAvatar id={t.agent} />
                <div>
                  <strong>
                    {agentBy(t.agent)?.name}
                    <span>
                      {state.nodes.find((n) => n.id === t.incidentId)?.title}
                    </span>
                  </strong>
                  <small>
                    Step {t.stage + 1} · version {t.version} ·{" "}
                    {t.status === "done"
                      ? "Checkpoint saved"
                      : t.status === "running"
                        ? "Task claimed"
                        : "Awaiting handoff"}
                  </small>
                </div>
                <span
                  className={`badge status-${t.status === "done" ? "resolved" : t.status === "running" ? "investigating" : "paused"}`}
                >
                  <i />
                  {t.status}
                </span>
                <ChevronRight size={16} />
              </button>
            ))
        ) : (
          <Empty
            icon={Workflow}
            title="Your first handoff starts here"
            text="Create an incident and let your team take it from signal to resolution."
          />
        )}
      </div>
    </>
  );
}

function SettingsPage({
  state,
  guide,
  refresh,
}: {
  state: Snapshot;
  guide: () => void;
  refresh: () => Promise<void>;
}) {
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const model = state.modelInfo;
  const provider = model.provider === "anthropic" ? "Claude" : "OpenAI";
  const status =
    model.status === "simulation"
      ? "Simulation · no API calls"
      : model.status === "ready"
        ? `${provider} · last request succeeded`
        : model.status === "error"
          ? `${provider} · needs attention`
          : `${provider} · ready to check`;
  const check = async () => {
    setChecking(true);
    setCheckError("");
    try {
      await api("/model/check", {});
    } catch (error) {
      setCheckError(
        error instanceof Error ? error.message : "Connection check failed.",
      );
    } finally {
      await refresh();
      setChecking(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR WORKSPACE, CONNECTED</p>
          <h1>Settings & connections.</h1>
          <p>
            A clear view of where your memory lives and how your agents work.
          </p>
        </div>
      </div>
      <div className="settings-grid">
        <div className="panel settings-panel">
          <h2>
            <Database size={19} /> Memory storage
          </h2>
          <span
            className={`badge status-${state.backend === "falkordb" ? "resolved" : "paused"}`}
          >
            <i />
            {state.backend === "falkordb"
              ? "FalkorDB connected"
              : state.backend === "browser"
                ? "Browser-local demo"
                : "SQLite · local preview"}
          </span>
          <p>
            {state.backend === "falkordb"
              ? "Each workspace has its own FalkorDB graph. Agents traverse relationships to retrieve memory."
              : state.backend === "browser"
                ? "This standalone demo stores sample data in this browser. Use one tab at a time. Run the local server for SQLite persistence or the FalkorDB-backed implementation."
                : "This preview saves state to a local SQLite database. Select FalkorDB in the server configuration to run the graph-backed version."}
          </p>
          <div className="config-snippet">
            <code>MEMORY_BACKEND=falkordb</code>
            <code>FALKORDB_PORT=6387</code>
          </div>
          <small>
            Connection settings stay on the server. See the project README for
            setup.
          </small>
        </div>
        <div className="panel settings-panel">
          <h2>
            <Sparkles size={19} /> Agent reasoning
          </h2>
          <span
            className={`badge status-${model.status === "ready" ? "resolved" : model.status === "error" ? "error" : "paused"}`}
          >
            <i />
            {status}
          </span>
          <p>
            {state.model === "simulation"
              ? "Agents follow a reproducible incident scenario using real persisted memory. No model calls are made in this mode."
              : `${provider} explains findings and answers follow-up questions using current workspace evidence and recent incident conversations. Recovery actions stay in the sandbox.`}
          </p>
          {model.model ? (
            <>
              <dl className="model-details">
                <div>
                  <dt>Model</dt>
                  <dd>{model.model}</dd>
                </div>
                <div>
                  <dt>Last request</dt>
                  <dd>
                    {model.checkedAt
                      ? new Date(model.checkedAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "Not checked yet"}
                  </dd>
                </div>
              </dl>
              <button
                className="button secondary"
                onClick={() => void check()}
                disabled={checking}
              >
                {checking ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Sparkles size={16} />
                )}
                {checking ? "Checking connection…" : "Test AI connection"}
              </button>
              <small>Runs one short API request without incident data.</small>
              {(checkError || model.error) && (
                <p className="form-error" role="alert">
                  {checkError || model.error}
                </p>
              )}
            </>
          ) : (
            <>
              <div className="config-snippet">
                <code>OPENAI_API_KEY=your-server-key</code>
                <code>OPENAI_MODEL=gpt-5.4-mini</code>
              </div>
              <small>
                {state.backend === "browser"
                  ? "OpenAI requires the local server. This standalone preview always uses simulation."
                  : "Add your key to the server .env file, restart RelayOps, then test the connection here."}
              </small>
            </>
          )}
        </div>
        <div className="panel settings-panel">
          <h2>
            <LockKeyhole size={19} /> Workspace boundaries
          </h2>
          <dl>
            <div>
              <dt>Current workspace</dt>
              <dd>{state.workspace.name}</dd>
            </div>
            <div>
              <dt>Access</dt>
              <dd>Demo owner · two sample workspaces</dd>
            </div>
            <div>
              <dt>Memory access</dt>
              <dd>
                {state.backend === "browser"
                  ? "Local sample workspace separation"
                  : "Server-authenticated workspace scope"}
              </dd>
            </div>
            <div>
              <dt>Conversation history</dt>
              <dd>Persisted with the incident</dd>
            </div>
          </dl>
          <p>
            Switch workspaces from the sidebar. Your demo account has access to
            both sample companies; their memories stay separate.
          </p>
        </div>
        <div className="panel settings-panel">
          <h2>
            <BookOpen size={19} /> Make the demo yours
          </h2>
          <p>
            Explore restart recovery, memory corrections, and how one agent
            picks up where another left off.
          </p>
          <button className="button secondary" onClick={guide}>
            Open demo playbook <ArrowUpRight size={15} />
          </button>
          <a className="button ghost" href="/api/export" download>
            Export workspace memory <Download size={15} />
          </a>
        </div>
      </div>
    </>
  );
}

const SCENARIO_OPTIONS = [
  {
    id: "pool",
    icon: Activity,
    name: "Connection exhaustion",
    hint: "Pool saturated. Recall the fix that worked.",
    title: "Checkout API is returning elevated errors",
    description:
      "Error rate crossed 10% after a traffic spike. Investigate the connection pool and recall any similar incidents.",
  },
  {
    id: "worker",
    icon: Workflow,
    name: "Hidden neighbour",
    hint: "Same symptom, different culprit two hops away.",
    title: "Checkout errors while a background queue grows",
    description:
      "Pool is saturated again, but the worker queue is also climbing. Atlas must decide whether this is the database or something sharing it.",
  },
  {
    id: "cache",
    icon: Zap,
    name: "Cache eviction",
    hint: "Users logged out. The database is fine.",
    title: "Customers are being logged out mid-checkout",
    description:
      "Cache miss rate spiked and evicted_keys is climbing. No database signals. Find the right runbook.",
  },
  {
    id: "migration",
    icon: GitCompareArrows,
    name: "Memory correction",
    hint: "New evidence invalidates the plan.",
    title: "Checkout failures after a database migration",
    description:
      "Investigate the failing service. At the approval checkpoint, introduce migration evidence to see the team correct stale memory and rebuild its plan.",
  },
];

function NewIncidentModal({
  close,
  create,
  busy,
}: {
  close: () => void;
  create: (data: any) => Promise<void>;
  busy: boolean;
}) {
  const [scenario, setScenario] = useState("pool");
  const [title, setTitle] = useState(
    "Checkout API is returning elevated errors",
  );
  const [description, setDescription] = useState(
    "Error rate crossed 10% after a traffic spike. Investigate the connection pool and recall any similar incidents.",
  );
  const [severity, setSeverity] = useState("P1");
  const [error, setError] = useState("");
  return (
    <Modal title="Give your team an incident." close={close}>
      <p className="modal-description">
        Start with a realistic scenario. Watch your agents connect the context.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await create({ title, description, severity, scenario });
          } catch (err: any) {
            setError(err.message);
          }
        }}
      >
        <label>Choose a scenario</label>
        <div className="scenario-options">
          {SCENARIO_OPTIONS.map((s) => (
            <button
              type="button"
              key={s.id}
              className={scenario === s.id ? "selected" : ""}
              onClick={() => {
                setScenario(s.id);
                setTitle(s.title);
                setDescription(s.description);
              }}
            >
              <s.icon size={20} />
              <strong>{s.name}</strong>
              <small>{s.hint}</small>
              <span className="radio-circle" />
            </button>
          ))}
        </div>
        <label htmlFor="incident-title">Incident title</label>
        <input
          id="incident-title"
          required
          minLength={5}
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="form-split">
          <div>
            <label htmlFor="severity">Severity</label>
            <select
              id="severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
            >
              <option value="P1">P1 · High priority</option>
              <option value="P2">P2 · Medium priority</option>
              <option value="P3">P3 · Low priority</option>
            </select>
          </div>
          <div>
            <label>Environment</label>
            <div className="read-only-field">
              <Box size={14} /> Simulated service
            </div>
          </div>
        </div>
        <label htmlFor="incident-description">What are you seeing?</label>
        <textarea
          id="incident-description"
          rows={3}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="form-note">
          <ShieldCheck size={16} />
          <span>
            Your agents work in a simulated environment. Every action is saved
            to the incident timeline.
          </span>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={close}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Plus size={16} />
            )}{" "}
            Create incident
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SearchModal({
  state,
  close,
  open,
  memory,
}: {
  state: Snapshot | null;
  close: () => void;
  open: (id: string) => void;
  memory: (m: Entity) => void;
}) {
  const [query, setQuery] = useState("");
  const results = (state?.nodes ?? [])
    .filter(
      (n) =>
        ["incident", "memory"].includes(n.kind) &&
        `${n.title} ${n.content ?? ""} ${n.number ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .slice(0, 10);
  return (
    <Modal title="Find the right context." close={close}>
      <div className="search-modal-input">
        <Search size={19} />
        <input
          aria-label="Search workspace"
          autoFocus
          placeholder="Search incidents, facts, and procedures…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <kbd>ESC</kbd>
      </div>
      <div className="search-results">
        {results.map((n) => (
          <button
            key={n.id}
            onClick={() => (n.kind === "incident" ? open(n.id) : memory(n))}
          >
            {n.kind === "memory" ? (
              <MemoryIcon category={n.category} />
            ) : (
              <span className="memory-icon">
                <Activity size={16} />
              </span>
            )}
            <div>
              <strong>{n.title}</strong>
              <small>
                {n.kind === "incident"
                  ? `${n.number} · ${labels[n.status]}`
                  : `${n.category} memory · ${n.source}`}
              </small>
            </div>
            <ArrowUpRight size={15} />
          </button>
        ))}
        {!results.length && (
          <Empty
            title="No matching context"
            text="Try another keyword. Search is limited to your current workspace."
          />
        )}
      </div>
      <div className="search-footer">
        <LockKeyhole size={12} /> Searching{" "}
        {state?.workspace.name ?? "your workspace"} only
      </div>
    </Modal>
  );
}

function MemoryModal({
  memory,
  nodes,
  close,
  select,
}: {
  memory: Entity;
  nodes: Entity[];
  close: () => void;
  select: (m: Entity) => void;
}) {
  const previous = nodes.find((n) => n.id === memory.supersedes);
  const replacement = nodes.find((n) => n.id === memory.supersededBy);
  return (
    <Modal title="A memory, with its context." close={close}>
      <div className="memory-detail">
        <div className="memory-detail-type">
          <MemoryIcon category={memory.category} />
          <span className={`category-label ${memory.category}`}>
            {memory.category} memory
          </span>
          <span className="memory-version">Version {memory.version}</span>
        </div>
        <h2>{memory.title}</h2>
        <p className="memory-detail-content">{memory.content}</p>
        <dl>
          <div>
            <dt>Source</dt>
            <dd>{memory.source}</dd>
          </div>
          <div>
            <dt>Contributed by</dt>
            <dd>{agentBy(memory.agent)?.name ?? "Operator"}</dd>
          </div>
          <div>
            <dt>Recorded</dt>
            <dd>{new Date(memory.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd className={memory.status === "active" ? "green-text" : "muted"}>
              {memory.status === "active"
                ? "Current · available to agents"
                : "Superseded · history preserved"}
            </dd>
          </div>
          {memory.verifiedRuns > 0 && (
            <div>
              <dt>Verified recoveries</dt>
              <dd>{memory.verifiedRuns}</dd>
            </div>
          )}
        </dl>
        {memory.steps && (
          <div className="procedure-steps">
            <h3>Recovery procedure</h3>
            {memory.steps.map((step: string, i: number) => (
              <div key={step}>
                <span>{i + 1}</span>
                {step}
              </div>
            ))}
          </div>
        )}
        {previous && (
          <button className="version-link" onClick={() => select(previous)}>
            <History size={17} />
            <div>
              <strong>Replaces an earlier fact</strong>
              <span>{previous.title}</span>
            </div>
            <ChevronRight size={16} />
          </button>
        )}
        {replacement && (
          <button className="version-link" onClick={() => select(replacement)}>
            <GitCompareArrows size={17} />
            <div>
              <strong>A newer fact is available</strong>
              <span>{replacement.title}</span>
            </div>
            <ChevronRight size={16} />
          </button>
        )}
        <div className="form-note">
          <LockKeyhole size={15} /> This memory is only available inside its
          workspace.
        </div>
      </div>
    </Modal>
  );
}

function GuideModal({
  close,
  start,
}: {
  close: () => void;
  start: () => void;
}) {
  return (
    <Modal title="A small demo. A bigger idea." close={close}>
      <p className="modal-description">
        Five moments that show what a team with shared memory can do.
      </p>
      <div className="guide-steps">
        {[
          {
            title: "Start with a signal",
            text: "Create a connection-exhaustion incident and start the investigation. Atlas recalls past outcomes and hands the context to Sage.",
            icon: Activity,
          },
          {
            title: "Let the next agent pick it up",
            text: "Watch the saved handoff. Sage uses the connected procedure to prepare a recovery plan for your approval.",
            icon: Workflow,
          },
          {
            title: "Change what the team knows",
            text: "At the approval checkpoint, introduce new evidence. The database fact is superseded, the old plan is invalidated, and a fresh plan can be built.",
            icon: GitCompareArrows,
          },
          {
            title: "Close the tab. Come back.",
            text: "Pause an investigation, reload the browser, or restart the API. Resume from the saved checkpoint. A crashed task lease expires after 60 seconds.",
            icon: History,
          },
          {
            title: "Keep each company’s context private",
            text: "Switch to Orbit Financial from the workspace menu. It has separate incidents, memories, and conversation history.",
            icon: LockKeyhole,
          },
        ].map((s, i) => (
          <div key={s.title}>
            <span className="guide-number">0{i + 1}</span>
            <div>
              <h3>
                <s.icon size={16} />
                {s.title}
              </h3>
              <p>{s.text}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="modal-actions">
        <button className="button secondary" onClick={close}>
          Back to workspace
        </button>
        <button className="button primary" onClick={start}>
          Try a scenario <ArrowRight size={16} />
        </button>
      </div>
    </Modal>
  );
}
