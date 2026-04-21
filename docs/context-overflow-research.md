# Context Window 溢出：各家 CLI 的處理方式

> 調查日期：2026-04-20

當 `save-my-session` 將一個大型 session 轉移到另一個 agent 時，對話歷史可能接近甚至超過目標 agent 的 context window 上限。本文件記錄各家 CLI 在這種情況下的處理機制。

---

## Claude Code

**Context window：** 200K tokens（標準），最高 1M（延伸 context 模型）

### 自動壓縮

- 在 context 容量的 ~**95%** 時觸發（可透過 `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` 設定）
- 壓縮後保留約原始 token 數的 ~**12%**（結構化摘要形式）
- 手動觸發：`/compact`（可加指示，例如 `/compact focus on the API changes`）

### 壓縮後什麼會留下

| 類別 | 是否保留 | 備註 |
|------|---------|------|
| System prompt | 是 | 從磁碟重新注入 |
| CLAUDE.md（使用者 + 專案） | 是 | 從磁碟重新注入 |
| Auto memory（MEMORY.md） | 是 | 前 200 行 / 25KB |
| MCP tool 定義 | 是 | 延遲重新注入 |
| 使用者的請求與意圖 | 是 | 在摘要中 |
| 關鍵技術概念 | 是 | 在摘要中 |
| 檢視/修改過的檔案 | 是 | 在摘要中（片段，非完整內容） |
| 錯誤及修復方式 | 是 | 在摘要中 |
| 待辦任務 / 目前進度 | 是 | 在摘要中 |
| Skill 描述清單 | 否 | 只保留實際呼叫過的 skill |
| 巢狀 CLAUDE.md 檔案 | 否 | 僅在 Claude 讀取該子目錄檔案時才重新載入 |
| 完整的 tool 輸出 | 否 | 被摘要取代 |
| 中間推理 / 逐字對話 | 否 | 消失 |
| 僅在對話中給出的詳細指示 | 否 | 可能遺失 |

### 失敗模式

| 情境 | 行為 |
|------|------|
| Context 接近上限 | 自動壓縮啟動，session 繼續 |
| 壓縮抖動（單一檔案/輸出立即塞滿 context） | 錯誤：「Autocompact is thrashing」— 需手動 `/compact` 指定重點或 `/clear` |
| Context 達到上限 | 硬牆：「Context limit reached — /compact or /clear to continue」 |
| 恢復大型 session | 完整歷史還原，必要時自動壓縮啟動 |

**重點：** Claude Code 不會拒絕載入 session，永遠會先嘗試壓縮。

### 已知 bug

- **#50920**：排程任務喚醒時 `autoCompact` 不會觸發（CronCreate/ScheduleWakeup/loop）。喚醒路徑上的 token 計數為空/過時。
- **#50947**：壓縮後，先前呼叫的過時 skill 參數會以 `<system-reminder>` 區塊重播。

### 設定

| 變數 | 用途 | 預設值 |
|------|------|--------|
| `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` | 觸發自動壓縮的 context 容量百分比 | ~95% |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | 覆寫有效 context window 大小 | 模型實際 window |
| `CLAUDE_CODE_MAX_CONTEXT_TOKENS` | 覆寫假定的 context window（僅搭配 `DISABLE_COMPACT`） | 模型預設值 |
| `DISABLE_COMPACT` | 完全停用自動壓縮 | 未設定 |

### 資料來源

- https://code.claude.com/docs/en/how-claude-code-works（「When context fills up」段落）
- https://code.claude.com/docs/en/context-window（互動式視覺化）
- https://code.claude.com/docs/en/costs（「Manage context proactively」）
- https://code.claude.com/docs/en/memory（「Instructions seem lost after /compact」）
- https://code.claude.com/docs/en/agent-sdk/agent-loop（「Automatic compaction」）
- https://code.claude.com/docs/en/env-vars（環境變數參考）
- https://github.com/anthropics/claude-code/issues/50920
- https://github.com/anthropics/claude-code/issues/50947

---

## Gemini CLI

**Context window：** 1,048,576 tokens（1M），所有模型皆同（Gemini 2.5 Pro/Flash、Gemini 3 Pro/Flash）

### 自動壓縮

- 在模型 token 上限的 **50%** 時觸發（可透過 `model.compressionThreshold` 設定）
- 三階段混合演算法：
  1. **Token 截斷**：較舊的 tool 回應 > 50K tokens 會被截斷到最後 30 行（20% 頭部 / 80% 尾部）
  2. **LLM 摘要**：獨立的 LLM 呼叫產生 `<state_snapshot>`，壓縮最舊的 ~70% 訊息（保留最新 ~30%）
  3. **驗證探測**：後續 LLM 呼叫評估摘要是否有遺漏
- 手動觸發：`/compress` 或 `/compact`

### 實驗性 context 管理

在 `experimental.contextManagement`（預設：關閉）下：

| 功能 | 設定 | 預設值 |
|------|------|--------|
| 輸出遮蔽 | 超過 `protectionThresholdTokens` 的舊輸出 | 50,000 |
| 蒸餾 | 超過 `summarizationThresholdTokens` 的輸出進行 LLM 摘要 | 20,000 → 10,000 |
| 歷史視窗 | `historyWindow.maxTokens` / `retainedTokens` | 150,000 / 40,000 |

### 失敗模式

| 情境 | 行為 |
|------|------|
| Context 達 50% | 自動壓縮啟動 |
| 訊息即將溢出（客戶端偵測） | 請求被擋，使用者收到警告，提示詞保留 |
| 壓縮失敗（結果膨脹） | `COMPRESSION_FAILED_INFLATED_TOKEN_COUNT` — 不會重試，除非手動觸發 |
| 壓縮失敗（空摘要） | `COMPRESSION_FAILED_EMPTY_SUMMARY` |
| Context 超過 100%（到達 API） | API 回傳 400 `INVALID_ARGUMENT` |
| Context 達 113%+（卡死） | **Session 死亡** — 無法傳送任何請求，包括壓縮 |
| 在 529K+ tokens 時壓縮 | OOM crash（Node.js 程序直接掛掉） |

**重要：** 壓縮結果不會存到磁碟。恢復 session 時載入的是未壓縮的歷史。

### 已知 bug

| Issue | 描述 |
|-------|------|
| #22942 | 113% 時「Invalid Argument」，無法壓縮 — session 報廢 |
| #19590 | 529K tokens 時壓縮導致 OOM crash |
| #15225 | 壓縮無法有效縮減大小 |
| #21335 | `/compress` 結果不會跨 session resume 保留 |
| #25211 | 長時間開啟 CLI 導致記憶體 + context window bug |
| #25264 | context 使用 10% 後開始變慢 |
| #6300 | 反覆壓縮失敗 |

### 資料來源

- google-gemini/gemini-cli 原始碼：`packages/core/src/core/tokenLimits.ts`、`packages/core/src/context/chatCompressionService.ts`、`packages/core/src/core/client.ts`
- https://geminicli.com（設定參考）
- https://github.com/google-gemini/gemini-cli/issues/22942
- https://github.com/google-gemini/gemini-cli/issues/19590
- https://github.com/google-gemini/gemini-cli/issues/21335

---

## Codex CLI

**Context window：** 272,000 tokens 預設（有效值：258,400，即 95%），GPT-5.4 最高 1M

### 自動壓縮

- 在 context window 的 **90%** 時觸發（預設模型約 ~244,800 tokens）
- 壓縮只擷取 **使用者訊息**（最多 20,000 tokens，偏重近期）送入 LLM 呼叫
- LLM 產生摘要，涵蓋：進度/決策、關鍵上下文、剩餘工作、重要參考
- 舊歷史被取代為：摘要 + ghost snapshots（供 `/undo` 使用）
- 如果壓縮呼叫本身觸發 `ContextWindowExceeded`，Codex 會反覆移除最舊的歷史項目直到 prompt 能放得下
- 手動觸發：`/compact`

### 壓縮後什麼會留下

| 類別 | 是否保留 |
|------|---------|
| 使用者訊息（作為摘要輸入） | 是 |
| LLM 產生的摘要 | 是 |
| Ghost snapshots（供 /undo） | 是 |
| **所有 tool 輸出** | **否**（典型 session 中約佔 79% 的 tokens，全部丟棄） |
| **所有 assistant 訊息** | **否** |
| **所有推理過程** | **否** |

這是已知且文件化的設計限制（issue #14589）。

### 失敗模式

| 情境 | 行為 |
|------|------|
| Context 達 90% | 自動壓縮啟動（turn 前或 turn 中） |
| 壓縮後 | Context 通常仍佔 75-87% — 快速進入再次壓縮循環 |
| 壓縮不足 | `ContextWindowExceeded` 錯誤 — **session 死亡** |
| 錯誤訊息 | 「Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying.」 |
| Exec（無頭）模式 | 自動壓縮有時不會觸發（bug #16033），導致 crash 循環 |
| 多次壓縮 | 每輪都有資訊損失（「傳話遊戲」效應），品質逐步劣化 |

### 已知 bug

| Issue | 描述 |
|-------|------|
| #9505 | 壓縮時重要的早期 context 被刪除 |
| #4106 | 無法控制自動壓縮參數（使用者要求關閉開關） |
| #14589 | 壓縮時靜默丟棄所有 tool 輸出和 assistant 推理 |
| #16033 | exec 模式下自動壓縮不會觸發 |
| #14447 | 非常頻繁的自動壓縮，壓縮後 context 幾乎仍滿 |
| #13909 | 壓縮只釋放約 25% 的空間 |
| #18052 | 「Codex ran out of room」— session 死亡 |
| #12790 | gpt-5.3-codex-spark 上「Codex ran out of room」 |

### 設定

在 `~/.codex/config.toml` 中：

```toml
model_context_window = 200000           # 覆寫 context window（tokens）
model_auto_compact_token_limit = 180000 # 覆寫壓縮觸發門檻
compact_prompt = "custom prompt..."     # 覆寫壓縮 prompt
```

### 資料來源

- openai/codex 原始碼：`codex-rs/core/src/compact.rs`、`codex-rs/core/src/compact_remote.rs`、`codex-rs/core/src/session/turn.rs`
- https://developers.openai.com/codex/config-reference
- https://developers.openai.com/codex/cli/slash-commands
- https://github.com/openai/codex/issues/14589
- https://github.com/openai/codex/issues/16033
- https://github.com/openai/codex/issues/18052

---

## 對 save-my-session 的影響

### 依轉移目標的風險評估

| 目標 | Context window | 風險等級 | 原因 |
|------|---------------|---------|------|
| Claude Code | 200K–1M | 低 | 永遠嘗試壓縮，不會拒絕載入 |
| Gemini CLI | 1M | 低～中 | window 大，但超過 100% 時 session 直接死掉 |
| Codex CLI | 272K | **高** | 最小的 window、壓縮損失大、溢出時 session 死掉 |

### 目前策略：硬轉過去，讓各家 CLI 自行處理

這個策略合理，原因：

1. 三家 CLI 都有內建壓縮機制 — 本來就設計來處理過大的 context
2. Claude Code 和 Gemini CLI 的 window 夠大（200K–1M），大部分 session 放得下
3. 轉移前估算 token 數不會準確（各家使用不同的 tokenizer）
4. 截斷早期訊息會失去轉移的意義（專案理解的 context 通常在最前面）

### 未來可能的改善

1. **字元數警告**：轉移前粗估（約 4 字元 ≈ 1 token），如果可能超過目標 window 就提醒使用者
2. **`--last N` 參數**：可選 — 只轉移最近 N 輪對話，給想避免壓縮的使用者使用
3. **目標感知警告**：特別針對 Codex（272K）— 當 session 超過約 800K 字元時發出警告
