export type NodeKind =
  | "incident"
  | "memory"
  | "event"
  | "task"
  | "service"
  | "message";
export type MemoryType = "episodic" | "semantic" | "procedural";
export type AgentId = "atlas" | "sage" | "echo";
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
  relation: string;
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
