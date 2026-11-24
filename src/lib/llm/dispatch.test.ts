// Run: node src/lib/llm/dispatch.test.ts
import assert from "node:assert/strict";
import { run, type Runners } from "./dispatch.ts";
import type { ProviderId } from "./models.ts";

// Fake runners: no model call, no child process. Each records the name it was called by and its arguments.
type Call = { name: string; args: Record<string, unknown> };
const calls: Call[] = [];
const fake = (name: string) => (args: Record<string, unknown>) => {
  calls.push({ name, args });
  return Promise.resolve(`${name}-result`);
};
const runners = {
  helper: fake("helper"),
  claude: fake("claude"),
  codex: fake("codex"),
  gemini: fake("gemini"),
  opencode: fake("opencode"),
  compat: fake("compat"),
} as unknown as Runners;

const provider = (id: ProviderId, extra: { helper?: boolean; use?: string; model?: string | null } = {}) => ({
  id,
  label: id,
  model: extra.model === undefined ? "a-model" : extra.model,
  models: [],
  ready: true,
  ...extra,
});
const emit = () => {};
const tools = [{ name: "t1" }, { name: "t2" }];
const base = {
  userId: "u1",
  system: "SYS",
  messages: [{ role: "user" as const, content: "hello" }],
  emit,
  tools: tools as never[],
};
const only = () => {
  assert.equal(calls.length, 1, "exactly one runner ran");
  return calls[0];
};

// 1. helper first, whatever the id.
calls.length = 0;
await run({ ...base, provider: provider("claude", { helper: true }) }, runners);
assert.equal(only().name, "helper", "helper: true goes to the helper runner");

calls.length = 0;
await run({ ...base, provider: provider("opencode", { helper: true }) }, runners);
assert.equal(only().name, "helper", "helper wins over opencode");

calls.length = 0;
await run({ ...base, provider: { ...provider("claude"), id: "made-up" as ProviderId, helper: true } }, runners);
assert.equal(only().name, "helper", "helper is checked before the id, as today");

// 2. Each CLI id goes to its own runner.
for (const id of ["claude", "codex", "gemini", "opencode"] as ProviderId[]) {
  calls.length = 0;
  await run({ ...base, provider: provider(id) }, runners);
  assert.equal(only().name, id, `${id} goes to its own runner`);
}

// 3. The OpenAI-compatible ids go to the compat runner.
for (const id of ["openrouter", "local"] as ProviderId[]) {
  calls.length = 0;
  await run({ ...base, provider: provider(id) }, runners);
  assert.equal(only().name, "compat", `${id} goes to the OpenAI-compatible runner`);
}

// 4. An id outside the union is refused, not absorbed.
calls.length = 0;
await assert.rejects(
  () => run({ ...base, provider: { ...provider("claude"), id: "nope" as ProviderId } }, runners),
  /No runner for provider nope/,
  "an unknown id throws",
);
assert.equal(calls.length, 0, "an unknown id runs nothing");

// 5. The arguments a route passes arrive unchanged.
calls.length = 0;
const signal = new AbortController().signal;
await run({ ...base, provider: provider("codex"), signal }, runners);
let got = only().args;
assert.equal(got.system, "SYS");
assert.equal(got.emit, emit, "the same emit function arrives");
assert.equal(got.tools, tools, "the same tools array arrives");
assert.equal(got.messages, base.messages, "the same messages array arrives");
assert.equal(got.signal, signal, "signal passes through when given");

calls.length = 0;
await run({ ...base, provider: provider("codex") }, runners);
got = only().args;
assert.equal(got.signal, undefined, "signal is undefined when not given");

// 6. compatTools defaults to tools, and overrides it when a route gives one.
calls.length = 0;
await run({ ...base, provider: provider("openrouter"), compatTools: [] }, runners);
got = only().args;
assert.deepEqual(got.compatTools, [], "compat gets the route's empty list");
assert.equal(got.userId, "u1");
assert.equal((got.provider as { label: string }).label, "openrouter", "compat gets the whole provider, label included");

calls.length = 0;
await run({ ...base, provider: provider("openrouter") }, runners);
assert.deepEqual(only().args.compatTools, undefined, "compatTools is left unset when a route gives none");

// 7. The helper and the compat runner get the user id; opencode gets use, else the provider's model.
calls.length = 0;
await run({ ...base, provider: provider("claude", { helper: true, use: "sonnet" }) }, runners);
got = only().args;
assert.equal(got.userId, "u1");
assert.equal((got.provider as { id: string }).id, "claude", "the helper gets the provider id");
assert.equal((got.provider as { use?: string }).use, "sonnet", "the helper reads the model off the provider");

calls.length = 0;
await run({ ...base, provider: provider("opencode", { use: "opencode/big" }) }, runners);
assert.equal((only().args.provider as { use?: string }).use, "opencode/big", "opencode uses use");

calls.length = 0;
await run({ ...base, provider: provider("opencode", { model: "opencode/small" }) }, runners);
assert.equal((only().args.provider as { model: string | null }).model, "opencode/small", "opencode falls back to model");

// 8. The MCP config builder is handed to claude, and to nothing else.
const mcpFile = () => "/tmp/x.json";
calls.length = 0;
await run({ ...base, provider: provider("claude"), mcpFile }, runners);
assert.equal(only().name, "claude");
assert.equal(only().args.mcpFile, mcpFile, "claude gets the builder, to call only when it runs");

calls.length = 0;
await run({ ...base, provider: provider("codex"), mcpFile }, runners);
assert.equal(only().args.mcpFile, mcpFile, "the builder travels with the args");

calls.length = 0;
await run({ ...base, provider: provider("claude") }, runners);
assert.equal(only().args.mcpFile, undefined, "claude gets no builder when the route offers none");

// 9. It returns exactly what the runner returned.
calls.length = 0;
assert.equal(await run({ ...base, provider: provider("gemini") }, runners), "gemini-result");

console.log("dispatch: ok");
