# 坦克大戰 v2（Tank Wars v2）

單檔 HTML5 Canvas 坦克遊戲，部署於 <https://cormort.github.io/tank-battle/>。
`index.html` 內含全部 HTML／CSS／JS（無建置流程、無相依套件），開檔即玩。

## 玩法

- 移動：`WASD` / 方向鍵（手機：左搖桿）
- 射擊：`空白鍵`（手機：右側 FIRE 鍵）
- 主動技能：`Q`　暫停：`P`　商店：`B`　音樂：`N`（或 HUD 按鈕）
- 效能面板：`F3`

每 3 關可選一次升級模組（武器進化／被動／主動技能），每 10 關進入生存割草模式。

## 開發與驗證

這是一個**單檔、無建置**的專案，所以驗證靠 `tools/verify-game.mjs`
（Playwright；用 `?bot` 模式驅動遊戲內部狀態）：

```bash
node tools/verify-game.mjs
# 需要 playwright 時：
#   npm i -D playwright && npx playwright install chromium
#   PW_MODULE=/path/to/playwright/index.js node tools/verify-game.mjs
# 也可以打遠端：
#   PROBE_URL=https://cormort.github.io/tank-battle/ node tools/verify-game.mjs
```

26 項檢查涵蓋：武器流派進化鏈、商店扣分時機、BARRIER 護盾時效、BOOST 方向、
子彈壽命回收、關卡結算（含範圍技清場與 BOSS 出生閘門）、菁英詞綴、
手機橫向版面與觸控目標、失去焦點時放開輸入與自動暫停、鍵盤操作、
DPR 渲染、以及效能路徑（基地老鷹離屏快取、坦克 sprite 快取、粒子批次、
NIGHT 漸層重用、爆炸音發聲上限）。離開碼 1 表示有案例失敗。

### 遊戲內建除錯鉤子

- `?bot`：把 `G`／`STATE`／`Pool`／`Tank` 等內部物件掛到 `window.__T`，並嘗試載入 `bot.js`
- `?speed=N`：加速模擬（1–20 倍）
- `?mute` / `?bot`：靜音
