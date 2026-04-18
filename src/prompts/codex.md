## Session Handoff (save-my-session)

你已安裝 save-my-session 工具，用於在不同 AI Coding Agent 之間無縫交接工作。

### 額度監控
- 注意你的 API 使用量。當你收到 rate limit 警告、或這個 session 已經進行超過 30 輪對話，主動提醒使用者：
  「⚠️ 額度可能快到上限了，要交接到其他 Agent 嗎？（Claude Code / Gemini CLI）」
- 如果使用者同意交接，執行以下步驟。

### 交接流程
當使用者同意交接時：

1. 生成一份完整的 **Project Briefing**，格式如下：

```
# Project Briefing

## 專案背景
（這個專案是什麼、解決什麼問題、核心架構）

## 技術棧與關鍵檔案
（使用的技術、最重要的檔案和它們的職責）

## 目前任務
（正在做什麼、做到哪裡、完成了什麼）

## 下一步
（接下來要做什麼，具體且可執行）

## 關鍵決策
（做過什麼重要決策、為什麼這樣選擇）

## 注意事項
（踩過的坑、重要限制、容易忽略的細節）
```

2. 將 briefing 寫入檔案 `.handoff-briefing.md`

3. 告知使用者 briefing 已儲存，並提供啟動目標 Agent 的指令：
   - 轉到 Claude Code：`claude -p "請先讀取 .handoff-briefing.md 的內容，這是前一個 Agent 的交接文件，讀完後告訴我你理解了什麼，然後繼續工作。"`
   - 轉到 Gemini CLI：`gemini -p "請先讀取 .handoff-briefing.md 的內容，這是前一個 Agent 的交接文件，讀完後告訴我你理解了什麼，然後繼續工作。"`
