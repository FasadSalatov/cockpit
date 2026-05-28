# Cockpit — Claude AI for VS Code

**Full-screen AI workspace for VS Code powered by your Claude subscription.** No API tokens — runs on your Pro/Max/Team Agent SDK credits. Part of the [Unyly](https://unyly.org) ecosystem.

> Chat + code edits with native VS Code inline-diff, session history, 6 themes (plus Custom), MCP servers, Tab inline completions, Run Tests & Fix, AI Find & Replace, Share via Gist, multimodal, slash commands, prompt templates and more.

[🇷🇺 Документация на русском](./README_RU.md)

---

## Highlights

- **Runs via Claude subscription** — OAuth token auth, uses your monthly Agent SDK credits, **no per-token API billing**.
- **Full-screen chat** in the editor — not a tiny sidebar, a dedicated webview tab.
- **Code edits — with approval** through a chat card + **native VS Code diff editor opens beside the panel**. Read-only auto, anything mutating asks.
- **3 working modes**: 🛡 Manual · ✏️ Accept edits · 🤖 Auto-agent.
- **Session history** in a sidebar: search, rename, fork, delete.
- **6 themes** + Custom, synced with full editor color themes (Color Theme palette).
- **Real-time subscription usage** — 5h/weekly limit progress bars exactly like claude.ai, input/output/cache tokens.
- **Inline completions** (Tab) with LRU cache — Haiku model via subscription.
- **CodeLens "🚀 Ask Cockpit"** above functions, **Code Action "Fix with Cockpit"** on diagnostics, **"Explain Selection inline"** (`Cmd+Shift+E`).
- **Slash commands**: `/loop` until green, `/tests` with auto-fix, `/find` semantic search, `/replace` AI find&replace, `/share` via GitHub Gist, `/cost`, `/model`, `/export`.
- **Multimodal**: drag&drop / paste images in chat.
- **MCP servers**: visual editor for stdio/http + env vars, passed to Agent SDK.
- **Workspace CLAUDE.md** with auto-reload watcher.
- **Prompt templates** in `.cockpit/prompts/*.md` (git-tracked, portable).
- **Achievements**, **Pomodoro timer**, **Speculative Haiku** preview, **Voice input** (via system dictation), **@-file mentions**.

---

## Install

### 1. Install Claude CLI and get an OAuth token

```bash
# install Claude Code CLI (needed for setup-token)
npm i -g @anthropic-ai/claude-code

# one-time auth — outputs sk-ant-oat01-… token
claude setup-token
```

### 2. Install the extension

**From VS Code Marketplace:** `Cmd+Shift+X` → search `Cockpit` → Install.

**From vsix release:** download the [latest release](https://github.com/FasadSalatov/cockpit/releases) and run:

```bash
code --install-extension unyly-cockpit-<version>.vsix
```

### 3. Connect the token

`Cmd+Shift+P` → **Cockpit: Open** → gear ⚙ in the top right → **Connect Claude** → paste `sk-ant-oat01-…`.

Done — open Cockpit (`Cmd+Shift+K`) and start typing.

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+Shift+K` | Open Cockpit |
| `Cmd+Shift+J` | Quick Ask (without opening the panel) |
| `Cmd+Shift+E` | Explain Selection inline (side-by-side) |
| `Enter` | Send |
| `Shift+Enter` | New line |
| `/` | Slash commands menu |
| `@` | Workspace file autocomplete |

---

## Slash commands

```
/clear           clear chat, start new session
/export          save session to .md via dialog
/share           publish session as GitHub Gist (needs gh CLI)
/loop <cmd>      agent runs command until green (max 5 iterations)
/tests           quick-pick of test commands + auto-fix failures
/find <intent>   semantic code search
/replace         AI find & replace across workspace
/cost            cost statistics
/model <opus|sonnet|haiku|default>   switch model
/help            command reference
```

---

## Themes

6 built-in plus Custom:
**Arcade** (dark indigo) · **Light** (cream) · **Synthwave** · **Matrix** · **Amber** (CRT) · **Midnight** · **Custom** (color picker).

Each theme is also a full **VS Code Color Theme** — pick `Cockpit Synthwave` from the `Color Theme` palette and the whole editor recolours in sync with the webview.

---

## Development

```bash
git clone https://github.com/FasadSalatov/cockpit
cd cockpit
pnpm install
pnpm build             # build webview + extension host
pnpm typecheck
pnpm redeploy          # bump version + build + vsce package + install in VS Code
```

Open in VS Code → `F5` to launch the Extension Development Host.

### Stack

- **Extension host**: TypeScript + esbuild (`src/`)
- **Webview**: React + Vite + Tailwind 4 (`webview/`)
- **Pixel art icons**: pixelarticons (offline via `@iconify/react`)
- **Code highlight**: lowlight (common languages) + hast-util-to-jsx-runtime
- **Markdown**: react-markdown + remark-gfm + custom plugins
- **Diagrams**: mermaid (lazy-loaded)
- **Virtualization**: @tanstack/react-virtual
- **Agent**: `@anthropic-ai/claude-agent-sdk` (ESM via dynamic import)

### Architecture

```
src/                  extension host (CJS bundle)
├── extension.ts      activation, commands, webview panels, MCP, watchers
├── agent.ts          wrapper over Agent SDK query()
└── protocol.ts       host ↔ webview types

webview/src/          React app (Vite bundle)
├── App.tsx           main chat
├── Sidebar.tsx       session history (in activity bar)
├── SettingsApp.tsx   full-screen settings panel
├── components/       UI + custom CodeBlock / Mascot / markdown
└── lib/              shared utils (settings, themes)

resources/            activity-bar icon, marketplace icon
themes/               generated VS Code color themes (gen-themes.mjs)
```

### Storage

- **Claude token** — VS Code SecretStorage
- **Settings/theme/model/cost/achievements** — `globalState`
- **Prompt templates** — `<workspace>/.cockpit/prompts/*.md`
- **Audit log** — `<workspace>/.cockpit/audit.log` (JSONL)
- **CLAUDE.md** — workspace root (auto-detected by Agent SDK)

---

## Security

- **Path allowlist** for `Edit`/`Write`: globs separated by spaces (`src/** app/**/*.ts`) — non-matching paths are auto-denied.
- **Disallow Bash patterns**: regex/substring list (`rm -rf  git push --force`).
- **Snapshot before edit** — automatic `git stash push -k -u` before every approved Edit/Write, rollback via standard git tools.
- **Audit log** — JSONL of all `prompt / tool / permission / result / error` to `.cockpit/audit.log`.
- **Budgets** — `$/day` and `$/session` limit with auto-stop.

The subscription token never reaches the webview — stored in VS Code SecretStorage, passed only to Agent SDK via host process `process.env`.

---

## Compatibility

- VS Code 1.90+
- macOS / Linux / Windows
- Claude Pro / Max / Team / Enterprise subscription (to use via subscription)
- Or `ANTHROPIC_API_KEY` (pay-as-you-go mode — `OAuth token` is overridden by API key, beware billing)

---

## License

[MIT](./LICENSE) · © 2026 Fasad Salatov / Unyly

---

<sub>Cockpit is part of **Unyly** — MCP Marketplace and tools for Claude. Learn more: [unyly.org](https://unyly.org).</sub>

<sub>Claude™ is a trademark of Anthropic, PBC. This extension is not affiliated with or endorsed by Anthropic; it uses the official Claude Agent SDK as a third-party integration.</sub>
