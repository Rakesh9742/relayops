export type NodeKind =
  | "incident"
  | "memory"
  | "event"
  | "task"
  | "service"
  | "person"
  | "team"
  | "decision"
  | "message";
export type MemoryType = "episodic" | "semantic" | "procedural";
export type AgentId = "atlas" | "sage" | "echo";

/** Typed relationships. These become real relationship types in the graph store. */
export type Relation =
  // topology
  | "DEPENDS_ON" // service -> service it calls
  | "ROUTES_TO" // gateway -> service
  // people
  | "OWNS" // team -> service
  | "MEMBER_OF" // person -> team
  | "ON_CALL_FOR" // person -> service
  | "RESOLVED" // person -> incident
  // incidents
  | "AFFECTS" // incident -> service
  | "ROOT_CAUSE" // incident -> service that actually failed
  | "SIMILAR_TO" // incident -> incident
  // memory
  | "HAS_MEMORY" // service -> memory
  | "LEARNED_FROM" // memory -> incident
  | "SUPERSEDES" // memory -> memory
  // decisions
  | "ABOUT" // decision -> service
  | "MADE_BY" // decision -> person
  | "BASED_ON" // decision -> incident | memory
  // workflow
  | "HAS_EVENT"
  | "HAS_TASK"
  | "HAS_MESSAGE"
  | "HANDS_OFF_TO"
  | "USES";

export interface Entity {
  id: string;
  kind: NodeKind;
  version: number;
  createdAt: number;
  [key: string]: any;
}
export interface Edge {
  from: string;
  to: string;
  relation: Relation | string;
}
export interface Workspace {
  id: string;
  name: string;
  initials: string;
  domain: string;
  color: string;
}
export interface ModelInfo {
  provider: "simulation" | "openai" | "anthropic";
  model: string | null;
  status: "simulation" | "unverified" | "ready" | "error";
  checkedAt: number | null;
  error?: string;
}
export interface Snapshot {
  workspace: Workspace;
  workspaces: Workspace[];
  nodes: Entity[];
  edges: Edge[];
  backend: "sqlite" | "falkordb" | "browser";
  model: ModelInfo["provider"];
  modelInfo: ModelInfo;
  serverStartedAt: number;
}

/** One hop in a graph path, used to show the reasoning behind an answer. */
export interface PathStep {
  from: string;
  relation: string;
  to: string;
}

/** A recorded graph tool invocation by an agent. Stored on events for traceability. */
export interface ToolTrace {
  tool: string;
  args: Record<string, any>;
  summary: string;
  nodeIds: string[];
  paths?: PathStep[];
}

export const AGENTS = [
  {
    id: "atlas" as AgentId,
    name: "Atlas",
    role: "Investigator",
    color: "#5675ca",
    description: "Follows evidence. Connects the dots.",
  },
  {
    id: "sage" as AgentId,
    name: "Sage",
    role: "Resolver",
    color: "#9c78ba",
    description: "Turns shared context into a plan.",
  },
  {
    id: "echo" as AgentId,
    name: "Echo",
    role: "Verifier",
    color: "#c39149",
    description: "Validates outcomes. Remembers what works.",
  },
];
