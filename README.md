# 🔄 save-my-session

> Smart project state snapshot tool for seamless AI coding agent handoffs

## 問題

「資源有限，需求無限」。當你使用多個 AI Coding Agent（Claude Code、Cursor、Copilot 等）開發專案時，經常遇到：

- ❌ **訂閱額度用完**：需要切換到另一個 Agent
- ❌ **Context 重建成本高**：新 Agent 需要重新理解專案、讀 git diff、猜測狀況
- ❌ **Token 浪費嚴重**：每次交接都要花費大量 tokens

## 解決方案

`save-my-session` 不是「轉移完整對話」，而是**壓縮專案理解**：

```
完整對話歷史（數千 tokens） ❌
         ↓
專案狀態快照（數百 tokens） ✅
```

### 核心概念

生成一個 `project_state.yml`，包含：

- ✅ **專案架構**：技術棧、關鍵檔案
- ✅ **當前任務**：目標、進度、下一步
- ✅ **決策脈絡**：為什麼這樣做
- ✅ **Git 狀態**：分支、未提交變更
- ✅ **重要 Context**：筆記、潛在問題

## 安裝

```bash
npm install -g save-my-session
```

或在專案中使用：

```bash
npm install --save-dev save-my-session
```

## 快速開始

### 1. 初始化專案狀態

```bash
save-my-session init
```

這會生成 `project_state.yml`，自動分析：
- 專案架構和技術棧
- Git 狀態
- 依賴套件

### 2. 在開發過程中記錄

**記錄重要決策：**

```bash
save-my-session update decision "使用 PostgreSQL | 需要 JSONB 支援"
```

**標記進度：**

```bash
save-my-session update progress "完成使用者認證 API"
```

**添加筆記：**

```bash
save-my-session update note "CORS 設定需要調整"
```

**記錄阻礙：**

```bash
save-my-session update blocker "等待 API key"
```

### 3. 切換到新 Agent

當你需要切換到另一個 AI Agent：

```bash
save-my-session restore --agent "Cursor"
```

會生成一份結構化的 context，你可以直接貼給新 Agent：

```markdown
# Project Handoff: my-project

## 📦 Project Overview
Architecture: Full-stack application
Tech Stack: React, TypeScript, FastAPI, PostgreSQL

## 🎯 Current Task
Goal: 實作使用者登入功能
Status: 70% 完成

Completed:
- 建立 User model
- 實作 JWT token 生成

Next Steps:
- 實作前端登入表單
- 整合 API endpoint

## 💡 Key Decisions
1. 使用 JWT 而非 Session
   Reason: 前後端分離，需要 stateless auth
...
```

### 4. 查看當前狀態

```bash
save-my-session info
```

## 命令參考

### `init`

初始化專案狀態

```bash
save-my-session init
```

### `snapshot`

手動生成快照（通常不需要，`init` 和 `update` 會自動更新）

```bash
save-my-session snapshot [options]

Options:
  -o, --output <path>  輸出檔案路徑（預設：project_state.yml）
  -v, --verbose        詳細輸出
```

### `update`

增量更新專案狀態

```bash
save-my-session update <type> <message>

Types:
  decision  - 記錄架構或技術決策
  progress  - 標記完成的工作
  blocker   - 記錄阻礙進度的問題
  note      - 添加重要筆記
```

**決策格式：**

```bash
save-my-session update decision "決策 | 原因 | 影響（可選）"
```

範例：

```bash
save-my-session update decision "使用 Redis 做快取 | 改善 API 回應時間 | 需要額外維護 Redis 服務"
```

### `restore`

生成給新 Agent 的 context

```bash
save-my-session restore [options]

Options:
  -i, --input <path>    輸入檔案路徑（預設：project_state.yml）
  -a, --agent <name>    目標 Agent 名稱
  -f, --format <type>   輸出格式（markdown|plain）
```

### `info`

顯示當前專案狀態摘要

```bash
save-my-session info
```

### `examples`

顯示使用範例

```bash
save-my-session examples
```

## 工作流程範例

### 完整開發週期

```bash
# 1. 開始新專案
save-my-session init

# 2. 開發過程中記錄決策
save-my-session update decision "使用 Tailwind CSS | 快速原型開發"

# 3. 標記完成的工作
save-my-session update progress "完成首頁 UI"
save-my-session update progress "整合 Stripe 付款"

# 4. 記錄重要筆記
save-my-session update note "生產環境需要設定 STRIPE_SECRET_KEY"

# 5. 額度用完，切換 Agent
save-my-session restore --agent "Claude Code"
# 複製輸出的 markdown，貼到新 Agent

# 6. 在新 Agent 繼續開發...
save-my-session update progress "完成付款成功頁面"

# 7. 再次切換
save-my-session restore --agent "Cursor"
```

## project_state.yml 結構

```yaml
meta:
  project_name: my-app
  last_updated: 2026-04-16T15:30:00Z
  last_agent: Claude Code
  snapshot_version: 0.1.0

architecture:
  summary: Full-stack application
  key_files:
    - src/main.ts
    - backend/api.py
  tech_stack:
    - React
    - TypeScript
    - FastAPI
  dependencies:
    react: ^18.0.0
    # ...

current_task:
  goal: 實作使用者登入功能
  status: 70% 完成
  completed:
    - 建立 User model
    - 實作 JWT token
  next_steps:
    - 實作登入表單
    - 整合 API
  blockers:
    - 等待設計稿確認

decisions:
  - decision: 使用 JWT 而非 Session
    reason: 前後端分離
    timestamp: 2026-04-16T14:00:00Z
    impact: 需要管理 token 過期

git_state:
  branch: feature/auth
  uncommitted_files:
    - src/Login.tsx
    - backend/auth.py
  recent_commits:
    - hash: abc123
      message: Add JWT generation

context:
  important_notes:
    - User table 有 email unique constraint
  potential_issues:
    - CORS 可能需要調整
  related_docs:
    - https://docs.project.com/auth
```

## 優勢

### vs. 轉移完整對話（如 `continues`）

| 特性 | save-my-session | 完整對話轉移 |
|------|----------------|-------------|
| Token 使用 | ✅ 數百 tokens | ❌ 數千 tokens |
| 理解品質 | ✅ 結構化、精確 | ⚠️ 冗長、雜訊多 |
| 可編輯性 | ✅ YAML 易編輯 | ❌ 對話格式難改 |
| 版本控制 | ✅ 可 commit | ⚠️ 不適合 git |
| 跨工具 | ✅ 通用格式 | ⚠️ 依賴工具格式 |

### vs. 手動撰寫交接文件

| 特性 | save-my-session | 手動文件 |
|------|----------------|---------|
| 速度 | ✅ 自動生成 | ❌ 耗時 |
| Git 分析 | ✅ 自動 | ❌ 手動 |
| 一致性 | ✅ 結構統一 | ⚠️ 因人而異 |
| 維護 | ✅ 增量更新 | ❌ 容易過時 |

## 進階使用

### 手動編輯 project_state.yml

你可以直接編輯 `project_state.yml` 來補充更多細節：

```yaml
current_task:
  goal: 實作使用者登入功能
  status: 70% 完成
  completed:
    - 建立 User model
    - 實作 JWT token 生成
    - 寫單元測試
  next_steps:
    - 實作前端登入表單 (使用 React Hook Form)
    - 整合 API endpoint (/api/auth/login)
    - 添加錯誤處理和驗證
  blockers:
    - 等待 UI/UX 團隊確認錯誤訊息文案
```

### Git Hooks 整合（未來功能）

```bash
# .git/hooks/pre-commit
save-my-session snapshot
```

### CI/CD 整合（未來功能）

在 PR 中自動生成專案狀態差異。

## 技術架構

- **語言**: TypeScript
- **CLI**: Commander.js
- **Git 分析**: simple-git
- **YAML 處理**: yaml
- **輸出美化**: chalk, ora

## 專案狀態

**Current Version**: 0.1.0 (MVP)

**已完成功能：**
- ✅ 自動專案分析（技術棧、檔案結構）
- ✅ Git 狀態分析
- ✅ Snapshot / Restore / Update 命令
- ✅ CLI 介面

**計劃功能：**
- ⏳ AI 智能壓縮（自動判斷重要 context）
- ⏳ Git hooks 整合
- ⏳ 多 Agent 協作支援
- ⏳ VS Code / JetBrains 插件
- ⏳ 視覺化狀態面板

## 貢獻

歡迎提交 Issues 和 Pull Requests！

## 授權

MIT

## 相關專案

- [continues](https://github.com/yigitkonur/cli-continues) - 跨工具 session 轉移
- [agent-deck](https://github.com/asheshgoplani/agent-deck) - 多 agent session 管理
- [crewAI](https://github.com/crewAIInc/crewAI) - Multi-agent 協作框架

---

**讓 AI Agent 交接更流暢，專注在真正重要的 Context！**
