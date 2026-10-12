import type { ModelInfo } from "../src/types";

export type ModelConfig =
  | { provider: "simulation" }
  | { provider: "openai" | "anthropic"; key: string; model: string };

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export function modelConfigFromEnv(
  env: Record<string, string | undefined> = typeof process === "undefined"
    ? {}
    : process.env,
): ModelConfig {
  const choice = env.MODEL_PROVIDER?.trim() || "auto";
  if (!["auto", "simulation", "openai", "anthropic"].includes(choice))
    throw new Error(
      "MODEL_PROVIDER must be auto, simulation, openai, or anthropic.",
    );
  if (choice === "simulation") return { provider: "simulation" };
  const openai = env.OPENAI_API_KEY?.trim();
  const anthropic = env.ANTHROPIC_API_KEY?.trim();
  if (choice === "openai" || (choice === "auto" && openai)) {
    if (!openai) throw new Error("Set OPENAI_API_KEY in the server .env file.");
    return {
      provider: "openai",
      key: openai,
      model: env.OPENAI_MODEL?.trim() || "gpt-5.4-mini",
    };
  }
  if (choice === "anthropic" || (choice === "auto" && anthropic)) {
    if (!anthropic)
      throw new Error("Set ANTHROPIC_API_KEY in the server .env file.");
    return {
      provider: "anthropic",
      key: anthropic,
      model: env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-5",
    };
  }
  return { provider: "simulation" };
}

export class ModelError extends Error {
  status = 502;
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const safeJson = (value: unknown): Record<string, any> => {
  if (object(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return object(parsed) ? parsed : {};
  } catch {
    return {};
  }
};
const help = (status: number) =>
  status === 401 || status === 403
    ? "Check the server API key and project permissions."
    : status === 429
      ? "Check API credits or rate limits, then retry."
      : status === 404
        ? "Check the configured model and your project's model access."
        : "Retry the request when the provider is available.";

/** A read-only tool the model may call. The workflow still owns all writes. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema
}
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}
export interface ToolRun {
  calls: ToolCall[];
  text: string;
  /** Structured answer when the model called the `finish` tool. */
  verdict?: Record<string, any>;
}

type Turn =
  | { role: "user" | "assistant"; content: string }
  | { role: "tool_calls"; calls: ToolCall[]; raw?: unknown }
  | { role: "tool_results"; results: Array<{ id: string; name: string; content: string }> };

// Tools are read-only graph queries. The workflow owns approvals, actions, and memory writes.
export class ReasoningClient {
  private state: ModelInfo;
  private checking?: Promise<ModelInfo>;

  constructor(
    private config: ModelConfig,
    private transport: typeof fetch = (...args) => fetch(...args),
  ) {
    this.state = {
      provider: config.provider,
      model: config.provider === "simulation" ? null : config.model,
      status: config.provider === "simulation" ? "simulation" : "unverified",
      checkedAt: null,
    };
  }

  get info(): ModelInfo {
    return { ...this.state };
  }

  async check(): Promise<ModelInfo> {
    if (this.config.provider === "simulation") return this.info;
    if (!this.checking) {
      this.checking = this.generate("Reply with READY.", "Connection check.")
        .then(() => this.info)
        .finally(() => {
          this.checking = undefined;
        });
    }
    return this.checking;
  }

  /**
   * Run a bounded tool loop. The model may call read-only tools up to
   * `maxRounds` times, then must answer. Every call is returned so the
   * workflow can record the exact evidence trail.
   */
  async runTools(
    instructions: string,
    input: string,
    tools: ToolSpec[],
    execute: (call: ToolCall) => Promise<string>,
    maxRounds = 6,
  ): Promise<ToolRun> {
    const config = this.config;
    if (config.provider === "simulation")
      throw new ModelError("AI is disabled. Add a server API key to enable it.");
    const name = config.provider === "openai" ? "OpenAI" : "Anthropic";
    const turns: Turn[] = [{ role: "user", content: input }];
    const calls: ToolCall[] = [];
    let verdict: Record<string, any> | undefined;
    for (let round = 0; round <= maxRounds; round++) {
      const forceAnswer = round === maxRounds;
      const result = await this.request(
        name,
        config,
        instructions +
          (forceAnswer
            ? "\n\nYou have used all tool calls. Call finish now with your best answer."
            : ""),
        turns,
        tools,
      );
      if (!result.calls.length) {
        return { calls, text: result.text, verdict };
      }
      turns.push({ role: "tool_calls", calls: result.calls, raw: result.raw });
      const results: Array<{ id: string; name: string; content: string }> = [];
      for (const call of result.calls) {
        calls.push(call);
        if (call.name === "finish") {
          verdict = call.args;
          results.push({ id: call.id, name: call.name, content: "Recorded." });
          continue;
        }
        let content: string;
        try {
          content = await execute(call);
        } catch (err) {
          content = `Tool error: ${err instanceof Error ? err.message : "failed"}`;
        }
        results.push({ id: call.id, name: call.name, content: content.slice(0, 6000) });
      }
      turns.push({ role: "tool_results", results });
      if (verdict) return { calls, text: result.text, verdict };
    }
    throw new ModelError(`${name} did not finish within the tool budget. Retry the request.`);
  }

  private async request(
    name: string,
    config: Extract<ModelConfig, { provider: "openai" | "anthropic" }>,
    instructions: string,
    turns: Turn[],
    tools: ToolSpec[],
  ): Promise<{ text: string; calls: ToolCall[]; raw: unknown }> {
    const body =
      config.provider === "openai"
        ? {
            model: config.model,
            instructions,
            input: turns.flatMap((t): unknown[] => {
              switch (t.role) {
                case "tool_calls":
                  return t.calls.map((c) => ({
                    type: "function_call",
                    call_id: c.id,
                    name: c.name,
                    arguments: JSON.stringify(c.args),
                  }));
                case "tool_results":
                  return t.results.map((r) => ({
                    type: "function_call_output",
                    call_id: r.id,
                    output: r.content,
                  }));
                default:
                  return [{ role: t.role, content: t.content }];
              }
            }),
            tools: tools.map((t) => ({
              type: "function",
              name: t.name,
              description: t.description,
              parameters: t.parameters,
              strict: false,
            })),
            store: false,
            max_output_tokens: 1800,
          }
        : {
            model: config.model,
            system: instructions,
            messages: turns.map((t): unknown => {
              switch (t.role) {
                case "tool_calls":
                  return {
                    role: "assistant",
                    content: t.calls.map((c) => ({
                      type: "tool_use",
                      id: c.id,
                      name: c.name,
                      input: c.args,
                    })),
                  };
                case "tool_results":
                  return {
                    role: "user",
                    content: t.results.map((r) => ({
                      type: "tool_result",
                      tool_use_id: r.id,
                      content: r.content,
                    })),
                  };
                default:
                  return { role: t.role, content: t.content };
              }
            }),
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters,
            })),
            max_tokens: 1200,
          };
    const parsed = await this.post(name, config, body);
    if (config.provider === "openai") {
      const output = Array.isArray(parsed.output) ? parsed.output : [];
      const calls: ToolCall[] = output
        .filter((i): i is Record<string, any> => object(i) && i.type === "function_call")
        .map((i) => ({
          id: String(i.call_id),
          name: String(i.name),
          args: safeJson(i.arguments),
        }));
      const text = output
        .flatMap((i) =>
          object(i) && i.type === "message" && Array.isArray(i.content) ? i.content : [],
        )
        .filter((p) => object(p) && p.type === "output_text" && typeof p.text === "string")
        .map((p) => (p as { text: string }).text)
        .join("\n")
        .trim();
      return { text, calls, raw: output };
    }
    const content = Array.isArray(parsed.content) ? parsed.content : [];
    const calls: ToolCall[] = content
      .filter((p): p is Record<string, any> => object(p) && p.type === "tool_use")
      .map((p) => ({ id: String(p.id), name: String(p.name), args: object(p.input) ? p.input : {} }));
    const text = content
      .filter((p) => object(p) && p.type === "text" && typeof p.text === "string")
      .map((p) => (p as { text: string }).text)
      .join("\n")
      .trim();
    return { text, calls, raw: content };
  }

  private async post(
    name: string,
    config: Extract<ModelConfig, { provider: "openai" | "anthropic" }>,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    try {
      const response = await this.transport(
        config.provider === "openai"
          ? "https://api.openai.com/v1/responses"
          : "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          signal: AbortSignal.timeout(40000),
          headers:
            config.provider === "openai"
              ? { "Content-Type": "application/json", Authorization: `Bearer ${config.key}` }
              : {
                  "Content-Type": "application/json",
                  "x-api-key": config.key,
                  "anthropic-version": "2023-06-01",
                },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) throw new ModelError(`${name} request failed (${response.status}). ${help(response.status)}`);
      const parsed: unknown = await response.json();
      if (!object(parsed)) throw new ModelError(`${name} returned an unreadable response. Retry the request.`);
      if (config.provider === "openai" && parsed.status !== "completed")
        throw new ModelError(`${name} did not complete its answer. Retry or select another model.`);
      if (config.provider === "anthropic" && parsed.stop_reason === "max_tokens")
        throw new ModelError(`${name} did not complete its answer. Retry the request.`);
      this.state = { ...this.state, status: "ready", checkedAt: Date.now(), error: undefined };
      return parsed;
    } catch (error) {
      const safeError =
        error instanceof ModelError
          ? error
          : new ModelError(
              error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
                ? `${name} timed out. Retry the request.`
                : `${name} could not be reached or returned an unreadable response. Retry the request.`,
            );
      this.state = { ...this.state, status: "error", checkedAt: Date.now(), error: safeError.message };
      throw safeError;
    }
  }

  async generate(instructions: string, input: string): Promise<string> {
    const config = this.config;
    if (config.provider === "simulation")
      throw new ModelError(
        "AI is disabled. Add a server API key to enable it.",
      );
    const name = config.provider === "openai" ? "OpenAI" : "Anthropic";
    try {
      const response = await this.transport(
        config.provider === "openai"
          ? "https://api.openai.com/v1/responses"
          : "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          signal: AbortSignal.timeout(25000),
          headers:
            config.provider === "openai"
              ? {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${config.key}`,
                }
              : {
                  "Content-Type": "application/json",
                  "x-api-key": config.key,
                  "anthropic-version": "2023-06-01",
                },
          body: JSON.stringify(
            config.provider === "openai"
              ? {
                  model: config.model,
                  instructions,
                  input,
                  store: false,
                  max_output_tokens: 1800,
                }
              : {
                  model: config.model,
                  system: instructions,
                  messages: [{ role: "user", content: input }],
                  max_tokens: 600,
                },
          ),
        },
      );
      if (!response.ok) {
        const help =
          response.status === 401 || response.status === 403
            ? "Check the server API key and project permissions."
            : response.status === 429
              ? "Check API credits or rate limits, then retry."
              : response.status === 404
                ? "Check the configured model and your project's model access."
                : "Retry the request when the provider is available.";
        // Never expose the provider error body: it may echo credentials or evidence.
        throw new ModelError(
          `${name} request failed (${response.status}). ${help}`,
        );
      }
      const body: unknown = await response.json();
      if (!object(body))
        throw new ModelError(
          `${name} returned an unreadable response. Retry the request.`,
        );
      let parts: unknown[];
      if (config.provider === "openai") {
        if (body.status !== "completed")
          throw new ModelError(
            `${name} did not complete its answer. Retry or select another model.`,
          );
        if (!Array.isArray(body.output))
          throw new ModelError(
            `${name} returned no answer. Retry the request.`,
          );
        parts = body.output.flatMap((item) =>
          object(item) &&
          item.type === "message" &&
          item.role === "assistant" &&
          Array.isArray(item.content)
            ? item.content
            : [],
        );
      } else {
        if (body.stop_reason === "max_tokens")
          throw new ModelError(
            `${name} did not complete its answer. Retry the request.`,
          );
        parts = Array.isArray(body.content) ? body.content : [];
      }
      if (parts.some((part) => object(part) && part.type === "refusal"))
        throw new ModelError(
          `${name} declined this request. Rephrase the question using incident evidence.`,
        );
      const text = parts
        .filter(
          (part) =>
            object(part) &&
            part.type ===
              (config.provider === "openai" ? "output_text" : "text") &&
            typeof part.text === "string",
        )
        .map((part) => (part as { text: string }).text)
        .join("\n")
        .trim();
      if (!text)
        throw new ModelError(`${name} returned no answer. Retry the request.`);
      this.state = {
        ...this.state,
        status: "ready",
        checkedAt: Date.now(),
        error: undefined,
      };
      return text;
    } catch (error) {
      const safeError =
        error instanceof ModelError
          ? error
          : new ModelError(
              error instanceof Error &&
                ["TimeoutError", "AbortError"].includes(error.name)
                ? `${name} timed out. Retry the request.`
                : `${name} could not be reached or returned an unreadable response. Retry the request.`,
            );
      this.state = {
        ...this.state,
        status: "error",
        checkedAt: Date.now(),
        error: safeError.message,
      };
      throw safeError;
    }
  }
}
