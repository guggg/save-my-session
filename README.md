# 🔄 save-my-session

> Transfer coding sessions between AI agents — Claude Code, Gemini CLI, and Codex.

當你手上有好幾個 AI Coding Agent 的訂閱（Claude Code、Gemini CLI、Codex），最痛的不是額度用完，而是**切換時整段 context 要重新來過**。`save-my-session` 把你在一個 agent 的 session 檔直接轉成另一家的原生格式，下個 agent 打開就是完整的對話歷史，不用再手抄 briefing。

## 功能

- **`transfer`**：把 Claude / Gemini / Codex 的 session 檔轉成另一家的原生格式，寫入對方的 session 目錄。
- **`install`**：把一段 handoff 指示注入各 agent 的全域 system prompt（`~/.claude/CLAUDE.md`, `~/.gemini/GEMINI.md`, `~/.codex/AGENTS.md`），讓 agent 自己偵測額度、主動建議交接。
- **`--append`**：把另一個 agent 做過的新進度（時間戳比目標 session 最後一則還新的訊息）回寫到原本的 session，方便來回切換。
- **`--list`**：列出目前專案所有 session，附帶最後一句 user 訊息、訊息數、時間區間。

## 安裝

```bash
npm install -g save-my-session
```

安裝完可選擇執行：

```bash
save-my-session install
```

這會在 `~/.claude/CLAUDE.md`、`~/.gemini/GEMINI.md`、`~/.codex/AGENTS.md` 裡各注入一段指示（用 `<!-- save-my-session:start -->` 標記包起來，隨時可 `uninstall` 移除）。裝完後各 agent 會在 session 變長或遇到 rate limit 時主動提醒使用者可以交接。

## 用法

> 所有指令都以 `cwd` 當作專案識別，**請在專案根目錄執行**，或用 `--cwd <path>` 指定。

### 列出當前專案的 session

```bash
save-my-session transfer --from claude --list
```

```
📋 Claude Code sessions for: /path/to/project

  #1 (latest)
     "好，開始做 ABC"
     58 user / 155 assistant messages
     4/16 10:51 → 4/18 10:24
     /Users/you/.claude/projects/-path-to-project/<uuid>.jsonl
  ...
```

### 轉移 session

最新的 Claude session → Gemini：

```bash
save-my-session transfer --from claude --to gemini
```

指定某個 session 檔：

```bash
save-my-session transfer --from gemini --to codex --session <path>
```

### 跨來回交接：把新進度 append 回原本的 session

情境：Claude 做了一段 → transfer 到 Gemini 繼續做 → 想回 Claude 時，不想開新 session，想接回原本那個：

```bash
save-my-session transfer --from gemini --to claude --append <原本的 claude session 路徑>
```

只有 timestamp 比 target 最後一則訊息**還新**的訊息會被 append 進去。

### 移除注入的指示

```bash
save-my-session uninstall
```

## Session 檔案位置

| Agent | 位置 |
|---|---|
| Claude Code | `~/.claude/projects/<path-with-dashes>/<uuid>.jsonl` |
| Gemini CLI | `~/.gemini/tmp/<slug>/chats/session-<ts>-<uuid>.json`（slug mapping 在 `~/.gemini/projects.json`）|
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`（`cwd` 在 `session_meta` 裡） |

轉移寫入的檔案會帶一個 `_transferred_by_save_my_session` 標記，`--list` 和後續的 transfer 會自動跳過，避免循環轉移。

## 技術架構

- **語言**：TypeScript (ESM)
- **CLI**：Commander.js
- **測試**：Vitest
- **核心流程**：三家各有 parser + writer，中間用 `UnifiedSession` 做轉換層

## 限制

- 只轉 user / assistant 的文字訊息。tool_use、thinking block 等會被跳過（各家格式差異太大，轉過去也跑不了）。
- Agent 啟動時不會自動「載入最新 session」——使用者要自己打開 CLI 並在該專案目錄下執行，該 agent 才會把 session 列進歷史。
- `--append` 用 timestamp 判斷去重，要求訊息都有正確的 ISO 8601 timestamp。

## 授權

MIT
