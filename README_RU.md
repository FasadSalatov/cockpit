# Cockpit — Claude AI для VS Code

**Полноэкранный кокпит для работы с Claude через твою подписку Pro/Max**, без оплаты токенов API. Часть экосистемы [Unyly](https://unyly.org).

> Чат + правки кода с inline-diff в нативном VS Code, история сессий, 6 тем (плюс «Своя»), MCP-серверы, inline-автодополнения, Run Tests & Fix, AI Find & Replace, Share via Gist, мультимодал, slash-команды, шаблоны промптов и многое другое.

---

## Главное

- **Через подписку Claude** — авторизация OAuth-токеном, расходует месячный Agent SDK кредит, **не платишь за токены API**.
- **Полноэкранный чат** в редакторе — не панелька сбоку, отдельный webview-таб.
- **Правки кода — с подтверждением** через карточку в чате + **inline-diff в нативном VS Code diff-editor** рядом. Read-only авто, всё изменяющее спрашивает.
- **3 режима работы**: 🛡 Ручной · ✏️ Принимать правки · 🤖 Авто-агент.
- **История сессий** в боковой панели: поиск, переименование, форк, удаление.
- **6 тем** + кастомная, синхронизированы с темами всего редактора (Color Theme в палитре).
- **Real-time usage** из подписки: прогресс-бары 5h/weekly лимитов как на claude.ai, токены input/output/кэш.
- **Inline-completions** (Tab) с LRU-кешем — модель Haiku через подписку.
- **CodeLens «🚀 Ask Cockpit»** над функциями, **Code Action «Fix with Cockpit»** на диагностиках, **«Объяснить выделение inline»** (`Cmd+Shift+E`).
- **Slash-команды**: `/loop` до зелёного, `/tests` с автопочинкой, `/find` семантический поиск, `/replace` AI find&replace, `/share` через GitHub Gist, `/cost`, `/model`, `/export`.
- **Мультимодал**: drag&drop / paste изображений в чат.
- **MCP-серверы**: визуальный редактор stdio/http + env, передаются в Agent SDK.
- **CLAUDE.md воркспейса** с авто-reload watcher'ом.
- **Шаблоны промптов** в `.cockpit/prompts/*.md` (живут в git, переносимы).
- **Achievements**, **Pomodoro в шапке**, **Speculative Haiku** превью, **Voice через системную диктовку**, **@-упоминания файлов**.

---

## Установка

### 1. Поставь Claude CLI и получи OAuth-токен

```bash
# установка Claude Code CLI (требуется для setup-token)
npm i -g @anthropic-ai/claude-code

# одноразовая аутентификация — выдаст токен sk-ant-oat01-…
claude setup-token
```

### 2. Установи расширение

**Из VS Code Marketplace:** `Cmd+Shift+X` → найди `Cockpit` → Install.

**Из vsix-релиза:** скачай [последний релиз](https://github.com/FasadSalatov/cockpit/releases) и выполни:

```bash
code --install-extension cockpit-<version>.vsix
```

### 3. Подключи токен

`Cmd+Shift+P` → **Cockpit: Open** → шестерёнка ⚙ в правом верхнем углу → **Подключение Claude** → **Задать токен** → вставь `sk-ant-oat01-…`.

Готово — открывай Cockpit (`Cmd+Shift+K`) и пиши.

---

## Горячие клавиши

| Шорткат | Действие |
|---|---|
| `Cmd+Shift+K` | Открыть Cockpit |
| `Cmd+Shift+J` | Быстрый вопрос (без открытия панели) |
| `Cmd+Shift+E` | Объяснить выделение inline (side-by-side) |
| `Enter` | Отправить |
| `Shift+Enter` | Перенос строки |
| `/` | Меню slash-команд |
| `@` | Автокомплит файлов воркспейса |

---

## Slash-команды

```
/clear           очистить чат, новая сессия
/export          сохранить сессию в .md через диалог
/share           опубликовать сессию как GitHub Gist (нужен gh CLI)
/loop <cmd>      агент гоняет команду до зелёного (макс 5 итераций)
/tests           quick-pick тестовых команд + автопочинка падения
/find <смысл>    семантический поиск по коду
/replace         AI find & replace по воркспейсу
/cost            статистика стоимости
/model <opus|sonnet|haiku|default>   сменить модель
/help            подсказка по командам
```

---

## Темы

6 встроенных + Своя:
**Аркада** (dark indigo) · **Светлая** (cream) · **Синтвейв** · **Матрица** · **Янтарь** (CRT) · **Полночь** · **Своя** (color-picker).

Каждая тема дублирована как полноценная **VS Code Color Theme** — выбери `Cockpit Synthwave` в палитре `Color Theme`, и весь редактор перекрасится синхронно с webview.

---

## Разработка

```bash
git clone https://github.com/FasadSalatov/cockpit
cd cockpit
pnpm install
pnpm build             # сборка webview + extension host
pnpm typecheck
pnpm redeploy          # бамп версии + build + vsce package + install в VS Code
```

Открой проект в VS Code → `F5` для запуска Extension Development Host.

### Стек

- **Extension host**: TypeScript + esbuild (`src/`)
- **Webview**: React + Vite + Tailwind 4 (`webview/`)
- **Pixel art icons**: pixelarticons (offline через `@iconify/react`)
- **Code highlight**: lowlight (common languages) + hast-util-to-jsx-runtime
- **Markdown**: react-markdown + remark-gfm + кастомные плагины
- **Diagrams**: mermaid (lazy-loaded)
- **Virtualization**: @tanstack/react-virtual
- **Agent**: `@anthropic-ai/claude-agent-sdk` (ESM через dynamic import)

### Архитектура

```
src/                  extension host (CJS bundle)
├── extension.ts      активация, команды, webview panels, MCP, watchers
├── agent.ts          обёртка над Agent SDK query()
└── protocol.ts       типы host ↔ webview

webview/src/          React-приложение (Vite bundle)
├── App.tsx           основной чат
├── Sidebar.tsx       история сессий (в activity bar)
├── SettingsApp.tsx   полноэкранная панель настроек
├── components/       UI + кастомный CodeBlock / Mascot / markdown
└── lib/              shared utils (settings, темы)

resources/            иконки активити-бара, marketplace icon
themes/               сгенерированные VS Code color themes (gen-themes.mjs)
```

### Структура хранилища

- **Токен Claude** — VS Code SecretStorage
- **Настройки/тема/модель/cost/achievements** — `globalState`
- **Шаблоны промптов** — `<workspace>/.cockpit/prompts/*.md`
- **Audit-журнал** — `<workspace>/.cockpit/audit.log` (JSONL)
- **CLAUDE.md** — корень воркспейса (распознаётся Agent SDK)

---

## Безопасность

- **Path-allowlist** для `Edit`/`Write`: globs через пробел (`src/** app/**/*.ts`) — несовпадения отклоняются.
- **Disallow Bash patterns**: regex/substring через пробел (`rm -rf  git push --force`).
- **Snapshot перед правкой** — автоматический `git stash push -k -u` перед каждой одобренной Edit/Write, откат стандартными git-средствами.
- **Audit log** — JSONL всех `prompt / tool / permission / result / error` в `.cockpit/audit.log`.
- **Бюджеты** — лимит `$/день` и `$/сессия` с автостопом.

Токен подписки никогда не попадает в webview — хранится в VS Code SecretStorage, передаётся только в Agent SDK через `process.env` хост-процесса.

---

## Совместимость

- VS Code 1.90+
- macOS / Linux / Windows
- Подписка Claude Pro / Max / Team / Enterprise (для использования через подписку)
- Или `ANTHROPIC_API_KEY` (платный режим — `OAuth токен` перебивается API-ключом, осторожно)

---

## Лицензия

[MIT](./LICENSE) · © 2026 Fasad Salatov / Unyly

---

<sub>Cockpit входит в экосистему **Unyly** — MCP Marketplace и инструменты для Claude. Подробнее: [unyly.org](https://unyly.org).</sub>
