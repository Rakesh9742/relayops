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

// This client has no tools. The workflow owns approvals, actions, and memory writes.
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
