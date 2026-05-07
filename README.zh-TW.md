# 🔄 save-my-session

[![npm](https://img.shields.io/npm/v/save-my-session)](https://www.npmjs.com/package/save-my-session) [![GitHub](https://img.shields.io/github/stars/guggg/save-my-session)](https://github.com/guggg/save-my-session/)

> 讓 AI Coding Agent 的 session 在 Claude Code、Gemini CLI、Codex 之間無縫轉移。

[English](https://github.com/guggg/save-my-session/blob/main/README.md)

當你手上有好幾個 AI Coding Agent 的訂閱（Claude Code、Gemini CLI、Codex），最痛的不是額度用完，而是**切換時整段 context 要重新來過**。`save-my-session` 把一個 agent 的 session 檔直接轉成另一家的原生格式。下一個 agent 打開就是完整的對話歷史，不用再手抄 briefing。

> **⚠️ 支援平台**：目前僅支援 **macOS / Linux**。Windows 尚未支援（Claude Code session 目錄的 slug 轉換邏輯需重新實作才能適配 Windows 路徑）。

<p align="center">
  <img src="https://raw.githubusercontent.com/guggg/save-my-session/main/docs/demo.zh.svg" alt="save-my-session 交接示範" width="860">
</p>

## 功能

- **`transfer`**：把 Claude / Gemini / Codex 的 session 檔轉成另一家的原生格式，寫入對方的 session 目錄。
- **`install`**：把一段 handoff 指示注入各 agent 的全域 system prompt（`~/.claude/CLAUDE.md`、`~/.gemini/GEMINI.md`、`~/.codex/AGENTS.md`），讓 agent 自己偵測額度、主動建議交接。
- **`--append`**：把另一個 agent 做過的進度回寫到原本的 session，方便來回切換。用訊息內容（role + text）去重，重複執行也安全。
- **`list`**：列出目前專案所有 session，附帶最後一則使用者訊息、訊息數、時間區間。

## 安裝

```bash
npm install -g save-my-session
```

安裝完可選擇執行：

```bash
save-my-session install
```

這會在 `~/.claude/CLAUDE.md`、`~/.gemini/GEMINI.md`、`~/.codex/AGENTS.md` 各注入一段指示（用 `<!-- save-my-session:start -->` 標記包起來，隨時可 `uninstall` 乾淨移除）。裝完後，當你說想切換 agent 時，當前 agent 就知道要怎麼寫 handoff summary 並給你轉移指令。

<p align="center">
  <img src="https://raw.githubusercontent.com/guggg/save-my-session/main/docs/demo-install.zh.svg" alt="install 示範" width="820">
</p>

## 用法

> 所有指令都以 `cwd` 當作專案識別，**請在專案根目錄執行**，或用 `--cwd <path>` 指定。

### 列出當前專案的 session

```bash
save-my-session list --from claude
```

```
📋 Claude Code sessions for: /path/to/project

  #1 (latest)
     "修好 append 去重的 bug 並重構 writers"
     42 user / 118 assistant 訊息
     4/18 10:24 → 4/18 14:52
     /Users/you/.claude/projects/-path-to-project/<uuid>.jsonl
  ...
```

<p align="center">
  <img src="https://raw.githubusercontent.com/guggg/save-my-session/main/docs/demo-list.zh.svg" alt="list 示範" width="760">
</p>

### 轉移 session

最新的 Claude session → Gemini：

```bash
save-my-session transfer --from claude --to gemini
```

指定某個 session 檔：

```bash
save-my-session transfer --from gemini --to codex --session <path>
```

### 轉移完後怎麼繼續對話

轉移寫入的是目標 Agent 的原生 session 檔，但**對方 CLI 不會自動載入最新 session**。標準流程：

1. 跑 `save-my-session transfer ...`
2. 打開目標 CLI（`claude`、`gemini` 或 `codex`）
3. 在 CLI 裡用 `/resume`（或該 Agent 的歷史 session 選單）挑剛轉過去的那個 session
4. 選中後就可以接著前一個 Agent 的進度繼續

> 👉 如果目標 Agent 的 CLI 原本就開著，要**關掉重開**才會掃到新寫入的 session 檔。

### 跨來回交接：把新進度 append 回原本的 session

情境：Claude 做了一段 → transfer 到 Gemini 繼續做 → 想回 Claude 時，不想開新 session，想接回原本那個：

```bash
save-my-session transfer --from gemini --to claude --append <hash 或完整路徑>
```

`--append` 後面的 hash 指的是**目標 session**（要被寫入的那個），不是 source。用 `save-my-session list --from <target>` 找。

用訊息內容（role + text）和目標 session 去重，重複執行也安全，第二次會回報 `appended: 0`。若要略過去重、把來源所有訊息都塞進去，加 `--force`。

<p align="center">
  <img src="https://raw.githubusercontent.com/guggg/save-my-session/main/docs/demo-append.zh.svg" alt="--append 示範" width="860">
</p>

### 移除注入的指示

建議先執行 `uninstall` 清除注入的 prompt，再移除套件。`npm uninstall` 會嘗試透過 `preuninstall` 自動執行，但不保證在所有環境都能觸發，手動先跑比較保險。

```bash
save-my-session uninstall
npm uninstall -g save-my-session
```

## Session 檔案位置

| Agent | 位置 |
|---|---|
| Claude Code | `~/.claude/projects/<path-with-dashes>/<uuid>.jsonl` |
| Gemini CLI | `~/.gemini/tmp/<slug>/chats/session-<ts>-<uuid>.jsonl`（slug 來自 `~/.gemini/projects.json`；session metadata 含 `projectHash = sha256(cwd)`）|
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`（`cwd` 在 `session_meta` 裡）。Codex 另外會在 `~/.codex/state_5.sqlite` 的 `threads` 表裡追蹤 session；`/resume` 讀的是這個 DB，所以轉移時兩邊都會註冊。 |

轉移寫入的檔案會帶一個 `_transferred_by_save_my_session` 標記。`list` 只會跳過「轉移後完全沒再動過」的檔案；如果你在 agent 裡繼續對話，這個 session 會被當成新的來源出現。

## 技術架構

- **語言**：TypeScript (ESM)
- **CLI**：Commander.js
- **測試**：Vitest
- **核心流程**：三家各有 parser + writer，中間用 `UnifiedSession` 做轉換層

## 限制

- 只轉 `user` / `assistant` 的文字訊息。`tool_use`、thinking block 等會被跳過（各家格式差異太大，轉過去也跑不了）。
- Agent 啟動時不會自動「載入最新 session」——要自己用 `/resume`（或該 agent 的歷史選單）挑剛轉過去的那個 session。
- `--append` 用訊息內容逐字比對（會 trim 掉前後空白）；如果兩邊訊息曾被編輯過，會被當成不同訊息。

## 授權

MIT
