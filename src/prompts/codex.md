## Session Handoff (save-my-session)

你已安裝 save-my-session 工具，它會把 Codex 的 session 直接轉成 Claude Code / Gemini CLI 的原生格式，讓下一個 Agent 直接「繼續」這場對話，不需要重新 briefing。

### 額度監控
- 注意你的 API 使用量。當你收到 rate limit 警告、或這個 session 已經進行超過 30 輪對話，主動提醒使用者：
  「⚠️ 額度可能快到上限了，要不要把這個 session 轉接到其他 Agent？（Claude Code / Gemini CLI）」
- 如果使用者同意，走下面的交接流程。

### 為什麼需要先寫 handoff summary

save-my-session **只會轉移 user / assistant 的文字訊息**，tool 呼叫、tool 輸出、內部推理都不會帶過去。也就是說：下一個 Agent 看不到你讀過什麼檔案、跑過什麼指令、看到什麼輸出，只看得到你們雙方講過的話。

而且 **使用者是在對話外層執行 transfer 指令**——你不會知道他何時按下 Enter，所以**不能等到移交當下才補上下文**。只要你判斷這個 session 有機會被移交（例如你已提醒過額度問題、或使用者表達想切換），**就必須在當下那則回覆裡直接寫好 handoff summary**，讓它留在對話紀錄裡。之後何時 transfer 都不影響。

### Handoff summary 寫什麼

在提議 transfer 的**同一則回覆**裡，用一段獨立的 markdown 區塊總結：

```
## Handoff summary

**目前在做什麼**：（1-2 句描述本次 session 的主要任務）

**已完成**：
- （條列式，具體到檔案路徑 / 函式名 / commit hash）

**改了哪些檔**：
- `path/to/file.ts:行號` — 做了什麼改動、為什麼
- （未 commit 的改動也要列）

**關鍵決策與理由**：
- （為什麼選方案 X 而不是 Y，來源是哪個檔案 / 文件 / 使用者偏好）

**未完成 / 下一步**：
- （下一個 Agent 應該做的第一件事）

**需要注意的陷阱**：
- （例如「第 N 行的邏輯看起來可疑但先不動」、「這個測試是 flaky」等）
```

寫 summary 時，**把你從 tool 輸出得到的關鍵資訊用自然語言寫進來**（例如「我讀了 `foo.ts`，發現它其實用了 X pattern」），這樣才會被帶過去。不要只寫「做了重構」這種沒有資訊量的句子。

### 交接流程

告訴使用者：在**專案根目錄**執行下列指令之一（擇一），就會把目前 session 完整複製到目標 Agent 的 session 目錄。

- 轉到 Claude Code：
  ```
  save-my-session transfer --from codex --to claude
  ```
- 轉到 Gemini CLI：
  ```
  save-my-session transfer --from codex --to gemini
  ```

執行完之後，告訴使用者：
1. 打開對應的 CLI（`claude` 或 `gemini`）
2. 在裡面用 `/resume`（或該 Agent 的歷史 session 選單）挑選剛轉過去的 session
3. 選中後即可繼續對話，完整歷史都在

（預設使用流程就是 **transfer → 開 CLI → `/resume` 挑 session**，不是直接打開 CLI 就會自動載入。）

### 常用輔助指令（提供給使用者參考）

- 列出目前專案可轉移的 session：`save-my-session list --from codex`
- 指定某個特定 session 轉移：`save-my-session transfer --from codex --to claude --session <path>`
- 把別的 Agent 做過的新進度 append 回你原本的 session（跨來回交接）：
  `save-my-session transfer --from claude --to codex --append <目標 session 檔案路徑>`

### 注意
- 指令預設以 `cwd` 當作專案識別，所以**一定要在專案根目錄執行**，否則會找不到 session。
- 若不在根目錄，請加 `--cwd <專案根目錄>`。
