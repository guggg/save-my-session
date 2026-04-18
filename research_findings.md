# LLM Agent 交接解決方案研究報告

**研究日期：** 2026-04-16  
**目標：** 解決不同 LLM Coding Agent 間任務交接時的 Token 浪費問題

---

## 問題陳述

### 核心痛點
1. **資源限制**：LLM 訂閱服務額度有限，軟體工程師經常用完
2. **交接成本高**：每次切換 Agent 都需要：
   - 重新理解整個專案架構
   - 讀取 git diff
   - 猜測當前任務狀態
   - 大量 Token 浪費在 context 重建

### 第一性原則分析

**真正需要交接的不是「對話歷史」，而是：**
- ✅ 專案結構的理解（檔案架構、關鍵邏輯）
- ✅ 當前任務的狀態（做到哪裡、下一步是什麼）
- ✅ 決策脈絡（為什麼選擇這個方案）
- ✅ Git 狀態（未完成的變更、意圖）
- ❌ 完整的對話紀錄（太冗長）

---

## 現有解決方案

### 1. **continues** - 跨工具 Session 交接工具

**GitHub:** https://github.com/yigitkonur/cli-continues  
**Stars:** 1k  
**最後更新:** 活躍開發中

#### 核心功能
解決「切換工具時遺失 30 條訊息的上下文、檔案變更和工作狀態」的問題。

#### 支援的工具（14個）
- Claude Code, Codex, GitHub Copilot CLI, Gemini CLI
- Cursor, Amp, Cline, Roo Code, Kilo Code, Kiro
- Crush, OpenCode, Factory Droid, Antigravity
- **支援 182 種跨工具轉移路徑**

#### 技術架構（四階段）

```
探索 → 解析 → 提取 → 交接
  ↓      ↓      ↓      ↓
掃描目錄  讀格式  收集資訊  生成文件
```

**1. 探索階段**
- 掃描所有工具的 session 目錄

**2. 解析階段**
- 讀取各工具的原生格式：
  - JSONL, JSON, SQLite, YAML

**3. 提取階段**
- 收集：
  - 最近訊息
  - 檔案變更
  - 工具活動（Bash, Edit, Search）
  - AI 推理過程

**4. 交接階段**
- 生成結構化上下文文件
- 注入目標工具

#### 使用方式

```bash
# 互動式選擇
npx continues

# 快速恢復最近 session
continues claude

# 跨工具交接
continues resume abc123 --in gemini

# 列出所有 sessions
continues list --json

# 診斷檢視
continues inspect abc123

# 批量匯出
continues dump all ./dir
```

#### 詳細度控制

| 預設 | 訊息數 | 工具示例 | 使用情景 |
|------|--------|---------|--------|
| minimal | 3 | 0 | Token 受限 |
| **standard** | **10** | **5** | **預設** |
| verbose | 20 | 10 | 複雜任務 |
| full | 50 | 全部 | 完整捕獲 |

#### 交接文件內容
- 最後 N 條訊息（可配置）
- 工具活動：Bash 指令、檔案編輯、搜尋操作
- Session 元資料：模型、Token 使用量、關鍵決策

#### 優點
✅ 支援多種工具  
✅ 靈活的詳細度控制  
✅ 保留工具操作歷史  
✅ 專案級配置（`.continues.yml`）

#### 限制
⚠️ 需要各工具有標準 session 儲存格式  
⚠️ 仍然是「轉移對話」而非「壓縮理解」

---

### 2. **agent-deck** - 多 Agent Session 管理中心

**GitHub:** https://github.com/asheshgoplani/agent-deck  
**Stars:** 2.1k  
**最後更新:** 2 天前

#### 核心價值
統一管理「10 個專案同時跑 Claude Code」的問題。

#### 支援的工具
- **完整整合：** Claude Code, Gemini CLI
- **狀態偵測：** OpenCode, Codex（含 conductor 支援）
- **Terminal 模式：** Cursor
- **可配置：** 自訂工具

#### 關鍵功能

**1. Session 管理**
- Fork sessions（保留對話歷史分支）
- 狀態偵測（running/waiting/idle/errored）
- 全域搜尋（跨所有 sessions）
- 群組組織 + 通知列

**2. MCP (Model Context Protocol) 管理**
- Attach/detach MCP servers（無需編輯 config）
- 切換 local/global scope
- Socket pooling（記憶體使用減少 85-90%）

**3. 進階功能**
- **Git worktree 整合**：隔離的平行開發
- **Docker sandbox**：隔離執行環境
- **Skills manager**：Claude 專案 skill 附加
- **成本追蹤儀表板**：預算限制
- **Conductor**：持久化 agent 編排 + Telegram/Slack 整合

#### 安裝

```bash
curl -fsSL https://raw.githubusercontent.com/asheshgoplani/agent-deck/main/install.sh | bash
```

#### 核心命令

```bash
# 建立 session
agent-deck add . -c claude

# 分支對話
agent-deck session fork

# 網頁介面
agent-deck web
```

#### 優點
✅ 多專案並行管理  
✅ 統一介面（TUI）  
✅ MCP 記憶體優化  
✅ 成本追蹤  
✅ Git worktree 支援

#### 適用場景
- 多個專案同時開發
- 需要頻繁 fork 對話分支
- 需要成本控制

---

### 3. **CrewAI** - Multi-Agent 協作框架

**GitHub:** https://github.com/crewAIInc/crewAI  
**Stars:** 49k

#### 核心概念

**兩種架構並用：**

1. **Crews**（自主協作）
   - Role-based collaboration
   - 真正的自主性和代理權
   - 動態決策與委派

2. **Flows**（精確控制）
   - Event-driven 控制
   - 條件分支
   - 複雜業務邏輯

#### 狀態管理
- 使用結構化狀態物件（Pydantic `BaseModel`）
- 跨工作流步驟的安全、一致狀態管理
- 控制資訊在執行階段間的傳遞

#### 記憶系統
- Agents 可利用記憶能力
- 可配置的記憶功能
- 跨互動保留 context

#### 整合模式
**Crews（自主決策）+ Flows（編排監督）= 生產級應用**

#### 適用場景
- 需要多個 Agent 協作完成複雜任務
- 需要精確控制執行流程
- 需要在自主性和控制之間取得平衡

---

### 4. **Ruflo** - Claude 專用 Agent 編排平台

**GitHub:** https://github.com/ruvnet/ruflo  
**Stars:** 32k  
**版本:** 活躍開發（1,470 releases）

#### 核心能力
- Multi-agent swarm deployment
- 自主工作流協調
- 對話式 AI 系統開發
- 企業級架構 + 分散式智能
- RAG 整合
- 原生 Claude Code/Codex 整合

#### 架構特點
- `.agents/` 目錄（agent 定義）
- `.claude/` 配置
- 多版本目錄（v2, v3）
- 完整測試套件

#### 限制
⚠️ 技術文件不完整（需查閱 CLAUDE.md, AGENTS.md）  
⚠️ 實作細節需閱讀原始碼

---

## Anthropic 官方資源

### Cookbook 相關範例

**位置:** https://github.com/anthropics/anthropic-cookbook

#### 相關資源
1. **Tool Use and Integration**
   - `tool_use/customer_service_agent.ipynb`
   - 展示長期交互的客服代理
   - 多輪對話管理

2. **Advanced Techniques**
   - **Sub-agents:** `multimodal/using_sub_agents.ipynb`
   - **Prompt Caching:** `misc/prompt_caching.ipynb`
     - 優化長對話效能和成本
     - 保留上下文同時提高效率

3. **RAG (Retrieval Augmented Generation)**
   - `capabilities/retrieval_augmented_generation`
   - 上下文增強

---

## 其他 Agent Orchestration 專案

### 熱門專案（按 Stars 排序）

| 專案 | Stars | 核心功能 |
|------|-------|---------|
| **crewAI** | 49k | Role-playing autonomous agents |
| **ruflo** | 32k | Claude 專用編排平台 |
| **conductor-oss/conductor** | 31.6k | Event-driven orchestration |
| **simstudioai/sim** | 27.8k | 中央智能層 |
| **labring/FastGPT** | 27.7k | 知識庫 + Agent + Workflow + MCP |
| **deepset-ai/haystack** | 24.8k | Open-source AI orchestration |
| **cft0808/edict** | 15.2k | 多代理編排 + 即時儀表板 |
| **microsoft/agent-framework** | 9.5k | Python & .NET 支援 |
| **awslabs/agent-squad** | 7.6k | 管理多代理與複雜對話 |

---

## 解決方案分析與建議

### 問題的層次

```
Level 1: 工具層 - 如何在工具間轉移 session？
         └─> continues, agent-deck

Level 2: 狀態層 - 如何壓縮並保存「理解」？
         └─> 需要設計專門的狀態格式

Level 3: 編排層 - 如何讓多個 Agent 協作完成任務？
         └─> crewAI, ruflo, conductor
```

### 當前解決方案的不足

**continues 和 agent-deck 的問題：**
- ❌ 仍然是「轉移對話」，而非「壓縮理解」
- ❌ 沒有針對「專案理解」進行優化
- ❌ 沒有智能判斷「哪些 context 真正重要」

### 理想的解決方案應該是什麼？

#### 核心概念：**Project State Snapshot**

不是轉移對話，而是生成一份「專案狀態快照」：

```yaml
# project_state.yml

meta:
  project_name: "my-app"
  last_updated: "2026-04-16T15:30:00Z"
  last_agent: "claude-code"
  
architecture:
  summary: "React frontend + FastAPI backend"
  key_files:
    - "src/components/App.tsx"
    - "backend/api/main.py"
  tech_stack: ["React", "TypeScript", "FastAPI", "PostgreSQL"]

current_task:
  goal: "實作使用者登入功能"
  status: "70% 完成"
  completed:
    - "建立 User model"
    - "實作 JWT token 生成"
  next_steps:
    - "實作前端登入表單"
    - "整合 API endpoint"
  
decisions:
  - decision: "使用 JWT 而非 Session"
    reason: "前後端分離，需要 stateless auth"
    timestamp: "2026-04-16T14:00:00Z"
  - decision: "密碼使用 bcrypt"
    reason: "安全性考量"
    timestamp: "2026-04-16T14:15:00Z"

git_state:
  branch: "feature/user-login"
  uncommitted_files:
    - "backend/api/auth.py"
    - "src/components/LoginForm.tsx"
  recent_commits:
    - hash: "abc123"
      message: "Add JWT token generation"
      
context:
  important_notes:
    - "User table 已經有 email unique constraint"
    - "前端使用 React Hook Form"
  potential_issues:
    - "CORS 設定可能需要調整"
```

#### 實作方向

**1. 自動生成 Project State**
```bash
# 新工具概念
save-my-session snapshot

# 生成內容：
# - 自動分析 git diff
# - 讀取最近的 agent 對話
# - 提取關鍵決策
# - 生成結構化狀態文件
```

**2. 智能 Context 恢復**
```bash
# 載入狀態到新的 agent
save-my-session restore --to gemini

# Agent 收到的 prompt：
# "你接手了一個專案，當前狀態如下：[壓縮的狀態描述]
#  請繼續完成：[當前任務]"
```

**3. 增量更新**
```bash
# 每次重要操作後自動更新
save-my-session update-decision "使用 Redis 做 session cache"
save-my-session mark-progress "完成使用者登入 API"
```

#### 優勢
✅ **大幅減少 Token 使用**（從數千 tokens 降到數百）  
✅ **更精確的 context**（只保留真正重要的資訊）  
✅ **決策追蹤**（知道為什麼這樣做）  
✅ **任務可見性**（清楚知道進度）  
✅ **跨工具通用**（不依賴特定 agent 格式）

---

## 下一步建議

### 短期（驗證概念）
1. **手動建立** `project_state.yml` 範本
2. 測試「給 Agent 讀狀態文件」vs「讀完整對話歷史」的效果
3. 比較 Token 使用量和理解品質

### 中期（MVP 開發）
1. 開發 CLI 工具：
   ```bash
   npm install -g save-my-session
   ```
2. 核心功能：
   - `snapshot`：生成狀態快照
   - `restore`：載入狀態到新 agent
   - `update`：增量更新狀態
3. 整合常見工具：Claude Code, Cursor, Gemini CLI

### 長期（完整生態）
1. **智能壓縮演算法**
   - AI 判斷哪些對話真正重要
   - 自動提取決策脈絡
2. **版本控制整合**
   - Git hooks 自動更新狀態
   - 狀態隨 commit 一起儲存
3. **Agent 間協作**
   - 多個 agent 同時工作在不同子任務
   - 自動同步狀態

---

## 參考資源

### 開源專案
- [continues](https://github.com/yigitkonur/cli-continues) - Session 轉移工具
- [agent-deck](https://github.com/asheshgoplani/agent-deck) - Multi-session 管理
- [crewAI](https://github.com/crewAIInc/crewAI) - Agent 協作框架
- [ruflo](https://github.com/ruvnet/ruflo) - Claude 編排平台

### 官方文件
- [Anthropic Cookbook](https://github.com/anthropics/anthropic-cookbook)
- [Claude API Docs](https://docs.anthropic.com/)

### 社群討論
- Hacker News: 搜尋 "AI coding agent"
- Lobsters: 關注 developer experience 討論
- GitHub Discussions: 各專案的 issues 和討論

---

**結論：** 現有工具主要解決「session 轉移」問題，但真正的機會在於設計一個「專案狀態壓縮」系統，從根本上減少跨 Agent 交接的 Token 成本。
