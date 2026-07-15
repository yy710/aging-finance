# Shared Agent Memory for Claude & Codex

This project uses `.agent-memory/` as the **human-readable shared memory store** across all AI coding agents, including Claude Code, Codex CLI, and compatible tools.

The goal is to **centralize long-term project knowledge**, reduce token usage, prevent duplication, and provide durable guidance for future tasks.

---

## 1. Memory Directory Structure

- .agent-memory/
  - project-overview.md # Project purpose, scope, and high-level summary
  - architecture.md # Modules, services, responsibilities, and relationships
  - decisions.md # Stable technical decisions and rationale
  - bugs-and-fixes.md # Reproducible errors, known issues, and fixes
  - commands.md # Verified shell, package, or API commands
  - current-state.md # Temporary task progress and ephemeral notes


**Guidelines:**

- Each file corresponds to a **specific knowledge category**.
- Only write content relevant to its category.
- Ephemeral or experimental notes go to `current-state.md`.
- Stable knowledge should be merged into the canonical files (architecture.md, decisions.md, bugs-and-fixes.md, commands.md).

---

## 2. Agent Behavior Rules

1. **Read Before Acting**:
   Always read the relevant `.agent-memory/` files **before starting any task** to avoid repeating past mistakes and to align with prior decisions.

2. **Update Only When Necessary**:
   - Record **durable project knowledge** only (e.g., confirmed architecture, verified fixes, permanent commands).
   - Do **not** record secrets, API keys, tokens, passwords, or sensitive credentials.

3. **Avoid Duplication**:
   - Check if a similar memory already exists.
   - Merge or update entries rather than creating duplicates.
   - Include references if needed (e.g., commit hash, session, source agent).

4. **Ephemeral Notes**:
   - Use `current-state.md` for **temporary task progress**, ongoing experiments, or in-progress work.
   - Avoid putting temporary notes in canonical files.

5. **Document Failed Attempts**:
   - If a task or approach failed, record it **only if it helps prevent future mistakes**.
   - Include context: steps attempted, outcome, and any warnings.

---

## 3. Content Guidelines

- **project-overview.md**:
  Summary of project goals, objectives, intended outcomes, and major milestones.

- **architecture.md**:
  - Module breakdown, responsibilities, dependencies.
  - Diagrams, file structures, service interactions (optional).
  - Key assumptions or constraints.

- **decisions.md**:
  - Permanent technical choices (frameworks, protocols, data storage).
  - Rationale for each decision (why this approach vs alternatives).

- **bugs-and-fixes.md**:
  - Reproducible issues, error messages, fixes applied.
  - Include versions, environment, and applicable context.

- **commands.md**:
  - Verified shell commands, package install commands, scripts.
  - Should be reusable and safe to execute.

- **current-state.md**:
  - Active tasks, temporary observations, work-in-progress.
  - Include timestamps, responsible agent, and relevant notes.
  - Can be cleared or pruned periodically.

---

## 4. Provenance and Traceability

- Each memory entry should include:
  - `source_agent`: Claude, Codex, or other agent.
  - `session_id` or timestamp of the update.
  - Optional: reference to commit, file, or task ID.
- This ensures **traceability** and makes it easier to review or merge entries.

---

## 5. Best Practices

- Always commit `.agent-memory/` files to **version control**.
- Agents should **read, summarize, and optionally compress** relevant content before using it as context.
- Use **embedding-based retrieval** or Headroom proxy if token usage is high or if historical context is long.
- Canonical files (`architecture.md`, `decisions.md`, `bugs-and-fixes.md`, `commands.md`) are **authoritative**; ephemeral notes (`current-state.md`) can be pruned or archived.

---

## 6. Integration with Headroom / LLMs

- **Headroom proxy / wrap** can reduce token usage but **does not automatically write to `.agent-memory/`**.
- To synchronize with `.agent-memory/`:
  - Agents must be **instructed via AGENTS.md / CLAUDE.md** to read/write specific files.
  - Headroom memory (`--memory`) can handle **cross-agent persistent memory** internally.
  - Canonical `.agent-memory/` remains **human-readable** and **Git-manageable**.

---

## 7. Summary Workflow for Agents

1. Read `.agent-memory/` files according to AGENTS.md rules.
2. Compress large logs / outputs with Headroom before sending to LLM (reduce token usage).
3. Perform task.
4. Update `.agent-memory/`:
   - Merge confirmed knowledge into canonical files.
   - Record temporary or in-progress notes in `current-state.md`.
5. Commit changes to version control periodically.

---

This structure ensures:

- **Cross-agent shared memory** for Claude, Codex, and other tools.
- **Reduced token usage** via Headroom compression.
- **Human-readable, version-controlled project knowledge**.
- **Clear separation** between permanent knowledge and ephemeral notes.

---

## 8. aging-finance Project Rules

- Active development branch: `develop`; keep `origin/develop` as the local upstream.
- Mirror completed commits to both `origin` (GitHub) and `gitee` (Gitee) when the user asks to push.
- Never store remote passwords, access tokens, the admin password, or the Cookie secret in documentation, Git remotes, commits, logs, or shared memory.
- Public pages are generated artifacts. Do not hand-edit `public-generated/`; change SQLite content, EJS templates, admin code, or source assets and regenerate.
- Production is served under `/af`; local direct Express testing normally uses `/admin/` and `/api/` because Nginx strips `/af` before proxying.
- Before closing code changes, run `git diff --check` and `npm test`. For generated-site changes, also run `PUBLIC_BASE_PATH=/af npm run generate`.
- For rendered admin changes, verify the target interaction in a browser and check console warnings/errors.
- Update `.agent-memory/current-state.md` with the verified commit and test baseline after durable changes.
