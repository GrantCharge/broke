# Glossary

The words this codebase uses for its own parts. One line each. The code is the source.

- **Runner**: one function that runs a single turn on one model. `runClaudeCode` and `runCodex` are runners.
- **Dispatch**: the choice of which runner answers a provider. It lives in `src/lib/llm/dispatch.ts` and nowhere else.
- **Picked**: a provider that is ready to run, plus the model to run it on. The gate builds it (`Picked` in `src/lib/llm/gate.ts`).
- **Helper**: the person's own computer, running their AI app for a hosted broke. It reuses the provider ids and sets `helper: true`.
- **Snapshot**: the compact data block given to the apps that have no tools. They answer only from it (`snapshot` in `src/lib/llm/cli-snapshot.ts`).
- **Level**: how much a model may see. `off`, `summary` or `full` (`Level` in `src/lib/privacy.ts`). A cloud model gets `summary` only.
