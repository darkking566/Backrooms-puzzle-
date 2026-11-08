# Backrooms：回聲

以 Backrooms 為題材、可在網頁（電腦與手機）上遊玩的第一人稱點擊式生存解謎遊戲，繁體中文與英文雙語。

> 目前是 **Level 0 第一個可玩版本（v0.1）**。Level 1 之後的層級還在製作中，抵達出口時會以結局頁代替。

## 開發

```sh
npm install
npm run dev        # 開發伺服器
npm test           # 測試（內容驗證、生成器、引擎）
npm run build      # 型別檢查＋輸出到 dist/
BOT=1 npx vitest run tests/bot.test.ts   # 自動遊玩機器人（數值平衡用）
```

網址加上 `?dev`（或 `#dev`）會出現開發選單：直接跳到曼尼拉房間、紅房間附近、生成閃爍牆、停電、時間 +24 小時。

推到 `main` 會由 GitHub Actions 跑測試並發布到 GitHub Pages（需要在 repo 設定的 Pages 選擇「GitHub Actions」）。

## 結構

| 資料夾 | 內容 |
|---|---|
| `content/` | 遊戲內容（YAML）：物品、液體、事件、結局、線索、Wiki 來源。建置時用 Zod 驗證 |
| `src/core/` | 引擎：指令、時間推進、隨機數流 |
| `src/world/` | Level 0 生成器、周邊偏移（純邏輯，不依賴畫面） |
| `src/systems/` | 生存數值與身體感覺描述 |
| `src/state/` | 存檔格式、IndexedDB 存檔 |
| `src/render/` | 3D 場景、材質、光照網格、聲音 |
| `src/ui/` | 介面（Preact） |
| `src/i18n/` | 介面文字（中／英） |

## 文件

- [`DESIGN.md`](DESIGN.md)：設計文件（第 12 節含主線劇透）
- [`docs/mockups/screens.html`](docs/mockups/screens.html)：最早的 2D 畫面樣稿
- [`docs/mockups/level0-3d.html`](docs/mockups/level0-3d.html)：Level 0 的 3D 技術展示
- [`docs/level-network.md`](docs/level-network.md)：Backrooms Wiki 層級網路整理
- [`docs/wiki-sources.md`](docs/wiki-sources.md)：Wiki 資料來源與署名

## 授權

層級、物品、實體設定來自 [Backrooms Wiki（Wikidot）](https://backrooms-wiki.wikidot.com)，採用 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)。
程式碼採 MIT，遊戲文字內容（`content/` 與介面文字）採 CC BY-SA 3.0。詳見 [`docs/wiki-sources.md`](docs/wiki-sources.md)。
