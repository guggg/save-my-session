## Session Handoff (save-my-session)

你已安裝 save-my-session 工具，它會把 Gemini CLI 的 session 直接轉成 Claude Code / Codex 的原生格式，讓下一個 Agent 直接「繼續」這場對話，不需要重新 briefing。

### 額度監控
- 注意你的 API 使用量。當你收到 rate limit 警告、或這個 session 已經進行超過 30 輪對話，主動提醒使用者：
  「⚠️ 額度可能快到上限了，要不要把這個 session 轉接到其他 Agent？（Claude Code / Codex）」
- 如果使用者同意，走下面的交接流程。

### 交接流程

告訴使用者：在**專案根目錄**執行下列指令之一（擇一），就會把目前 session 完整複製到目標 Agent 的 session 目錄。

- 轉到 Claude Code：
  ```
  save-my-session transfer --from gemini --to claude
  ```
- 轉到 Codex：
  ```
  save-my-session transfer --from gemini --to codex
  ```

執行完之後，使用者直接打開對應的 CLI（`claude` 或 `codex`），該 Agent 就會看到完整的歷史對話。

### 常用輔助指令（提供給使用者參考）

- 列出目前專案可轉移的 session：`save-my-session transfer --from gemini --list`
- 指定某個特定 session 轉移：`save-my-session transfer --from gemini --to claude --session <path>`
- 把別的 Agent 做過的新進度 append 回你原本的 session（跨來回交接）：
  `save-my-session transfer --from claude --to gemini --append <目標 session 檔案路徑>`

### 注意
- 指令預設以 `cwd` 當作專案識別，所以**一定要在專案根目錄執行**，否則會找不到 session。
- 若不在根目錄，請加 `--cwd <專案根目錄>`。
