import type { ProviderInfo } from "@/lib/llm/config";
import type { ProviderId } from "@/lib/llm/models";
import type { ChatMessage, Emit, Tool } from "@/lib/llm/shared";

// The one place that picks a model runner. The routes own everything after it: the chat streams and closes,
// the check-in saves, the plan parses and retries. This module does not emit, save or close anything.

/** What a runner may receive. Every runner reads a subset; a route passes only what it passed before. */
export type RunArgs = {
  provider: ProviderInfo & { use?: string };
  userId: string;
  system: string;
  messages: ChatMessage[];
  emit: Emit;
  /** The tool list for the runners that read one: codex, gemini, opencode, helper, and compat's default. */
  tools: Tool[];
  /** The OpenAI-compatible runner's tool list. Defaults to `tools`. Check-ins and the plan pass an empty list:
   *  their facts are already in the prompt, and a tool loop there would differ from today. */
  compatTools?: Tool[];
  signal?: AbortSignal;
  /** Builds the Claude MCP config path. Called only for claude, so check-ins and the plan never build one. */
  mcpFile?: () => string | Promise<string>;
};

/** The six runners, as one slot each. Injectable so a test runs with no model call. */
export type Runners = Record<"helper" | "claude" | "codex" | "gemini" | "opencode" | "compat", (args: RunArgs) => Promise<unknown>>;

/** The id each runner answers to. `helper` is checked first, and `openrouter` and `local` both speak the OpenAI API. */
const SLOT: Record<ProviderId, keyof Runners> = {
  openrouter: "compat",
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
  opencode: "opencode",
  local: "compat",
};

/** The real runners, loaded on first use so this module stays importable by plain `node`. */
async function realRunners(): Promise<Runners> {
  const [{ runViaHelper }, { runCodex, runGemini, runOpencode }, { runClaudeCode }, { runOpenAICompat }, { compatRun }] = await Promise.all([
    import("@/lib/llm/helper"),
    import("@/lib/llm/cli-snapshot"),
    import("@/lib/llm/claude-code"),
    import("@/lib/llm/openai-compat"),
    import("@/lib/llm/providers"),
  ]);
  const claude = async (a: RunArgs) => runClaudeCode({ messages: a.messages, mcpFile: await a.mcpFile?.(), system: a.system, emit: a.emit, signal: a.signal, model: a.provider.use });
  return {
    helper: (a) => runViaHelper({ userId: a.userId, provider: a.provider.id, model: a.provider.use, system: a.system, tools: a.tools, messages: a.messages, emit: a.emit, signal: a.signal }),
    claude,
    codex: (a) => runCodex({ system: a.system, tools: a.tools, messages: a.messages, emit: a.emit, signal: a.signal }),
    gemini: (a) => runGemini({ system: a.system, tools: a.tools, messages: a.messages, emit: a.emit, signal: a.signal }),
    opencode: (a) => runOpencode({ system: a.system, tools: a.tools, messages: a.messages, emit: a.emit, signal: a.signal, model: a.provider.use ?? a.provider.model! }),
    compat: async (a) => runOpenAICompat({ ...(await compatRun(a.provider, a.userId)), label: a.provider.label, system: a.system, messages: a.messages, tools: a.compatTools ?? a.tools, emit: a.emit, signal: a.signal }),
  };
}

/**
 * Runs one turn on the provider's own runner and returns what that runner returned. A provider id outside the
 * union throws, so a new id must be given a runner rather than silently reaching the OpenAI-compatible one.
 */
export async function run(a: RunArgs, runners?: Runners): Promise<unknown> {
  const set = runners ?? (await realRunners());
  const slot = a.provider.helper ? "helper" : SLOT[a.provider.id];
  const picked = slot && set[slot];
  if (!picked) throw new Error(`No runner for provider ${String(a.provider.id)}`);
  return picked(a);
}
