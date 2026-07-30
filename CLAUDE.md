# CLAUDE Instructions for Shared Agent Memory

This file instructs Claude Code on how to properly interact with the project's shared memory (`.agent-memory/`) and use Headroom for token optimization.

---

## 1. Initial Setup

1. Before starting any task, **read the relevant files** under `.agent-memory/`:
   - `project-overview.md`
   - `architecture.md`
   - `decisions.md`
   - `bugs-and-fixes.md`
   - `commands.md`
   - `current-state.md`

2. If the context for your task is large, use **Headroom compression** (via proxy or wrap) to reduce token usage.

3. Any **cross-agent persistent memory** maintained by Headroom (`--memory`) is supplemental.
   The **canonical `.agent-memory/` files remain the human-readable source of truth**.

---

## 2. Memory Writing Rules

1. **Update canonical files** only when:
   - A decision, architecture change, or fix is **confirmed** and durable.
   - A command or procedure is **verified and reusable**.

2. **Update `current-state.md`** for:
   - Temporary task progress
   - In-progress experiments
   - Notes that are not yet confirmed

3. **Never write secrets**:
   - API keys, passwords, tokens, or any sensitive credentials must not be stored.

4. **Avoid duplication**:
   - Check existing entries before adding new ones.
   - Merge or append relevant details if similar knowledge exists.

5. **Record failed approaches**:
   - Only log if it helps prevent repeating mistakes.
   - Include context: what was attempted, what failed, and why.

---

## 3. Provenance and Traceability

- Every entry should ideally include:
  - `source_agent`: Claude or other agent
  - `session_id` or timestamp
  - Optional references: commit hash, task ID, or file reference
- This ensures traceable, reviewable, and mergeable knowledge.

---

## 4. Using Memory During Tasks

1. Before executing a task, **scan relevant files** to understand existing architecture, decisions, commands, or known bugs.

2. Use **Headroom**:
   - Compress logs, large outputs, and historical context before sending to the model to reduce token usage.
   - Persistent Headroom memory (`--memory`) can store cross-agent compressed context.

3. When retrieving knowledge:
   - Prefer canonical `.agent-memory/` files for authoritative information.
   - Use Headroom memory for quick retrieval or semantic search of past actions.

---

## 5. Best Practices for Updates

- For durable knowledge (architecture, decisions, verified commands, reproducible fixes), **update canonical files**.
- For temporary, ephemeral, or work-in-progress notes, **update `current-state.md`**.
- Commit `.agent-memory/` files regularly to version control to preserve history and allow team review.
- Periodically prune `current-state.md` to avoid accumulation of outdated or irrelevant notes.

For this repository, also follow the project-specific rules in `AGENTS.md`, especially the `develop` branch, GitHub/Gitee mirror, `/af` proxy boundary, generated-output boundary, pinned native install-script approval, secret-handling rules, and verification commands. For production publication or 502/cache incidents, read `docs/home-v2-production-repair-2026-07-30.md`.

---

## 6. Example Workflow

```text id="workflow-example"
1. Start task
   - Read .agent-memory files
   - Compress large previous outputs with Headroom
2. Execute task
3. Update:
   - confirmed fixes → bugs-and-fixes.md
   - new architecture → architecture.md
   - verified commands → commands.md
   - temporary observations → current-state.md
4. Commit changes
```
