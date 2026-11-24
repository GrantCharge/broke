# 0001. One dispatch module is the only AI tool path

## Status

Accepted. 2026-11-24.

## Context

Three API routes each ran a model: chat (`src/app/api/assistant`), check-ins (`src/app/api/checkins`) and the money plan (`src/app/api/plan`). Each held its own copy of the same six-way choice: helper, then Claude, Codex, Gemini, opencode, else the OpenAI-compatible runner.

The copies had drifted in seven ways. They passed different arguments. Only chat passed an abort signal. Only chat gave Claude a real MCP config, with the other two writing an empty file on every run. Only chat let the OpenAI-compatible model call tools. One copy passed two arguments the Claude runner never read. Two copies built the tool list without a profile. The two empty files were written with default permissions.

The final `else` also absorbed any unknown provider id. A new provider id reached the OpenAI-compatible runner by accident, and the compiler could not report it.

## Decision

One module, `src/lib/llm/dispatch.ts`, owns the six-way choice and calls the runner. It does nothing else: no emit, no save, no stream close. The routes keep their own steps after the call, because those differ on purpose. Chat streams and closes. Check-ins check the reply against the facts and save. The plan parses, retries and saves.

The pick order stays exactly as it was. The id type is the `ProviderId` union, so a new id must be given a runner, and an id outside the union throws.

The runners are injectable, so a test proves the choice with fake runners and no model call.

## Consequences

- A new provider id is added in one place, and the compiler asks for its runner.
- A route can no longer quietly send different arguments to the same runner. A difference has to be an argument the route passes.
- The routes still own their after-steps. A change to how chat streams, or how a check-in is saved, stays in that route.
- The Claude MCP config is now built only for Claude, and only when a route offers one. The lockdown still holds: `--strict-mcp-config` alone loads no MCP server.
- The rule is written in `AGENTS.md`. A provider ladder in a route is a review failure.
