# 坦克大戰 v2（Tank Wars v2）

單檔 HTML5 Canvas 坦克遊戲，部署於 <https://cormort.github.io/tank-battle/>。
`index.html` 內含全部 HTML／CSS／JS（無建置流程、無相依套件），開檔即玩。

## 玩法

- 移動：`WASD` / 方向鍵（手機：左搖桿）
- 射擊：`空白鍵`（手機：右側 FIRE 鍵）
- 主動技能：`Q`　暫停：`P`　商店：`B`　音樂：`N`（或 HUD 按鈕）
- 效能面板：`F3`

每 3 關可選一次升級模組（武器進化／被動／主動技能），每 10 關進入生存割草模式。

## 專案結構

```
index.html          遊戲本體（單檔可開，<script type="module">）
src/data/           資料層：唯一來源，這裡改數值就是改遊戲
  config.js           CONFIG（畫布、子彈、粒子、池、AI、玩法）
  weapons.js          四條流派樹、射擊參數、起始武器、掉落池
  upgrades.js         被動／主動技能
  pickups.js          道具與掉落池
  enemies.js          菁英詞綴、特殊敵人類型
  shop.js             商店品項
  events.js           Director 事件（工廠 + 注入 ctx）與地圖事件
  schema.js           必填欄位、型別、進度鏈、可達性規則
tools/              驗證工具（Node + Playwright）
```

`index.html` 只 import 資料層；資料不再內嵌。**不需要建置流程**（原生 ESM，GitHub Pages 直接支援）。

### 資料層的邊界

- 資料檔不得 import 遊戲內部。Director 事件需要執行期物件（`G`／`Tank`／`W`…）時，
  由呼叫端以 getter 注入（`makeDirectorEvents(ctx)`）—— 依賴因此是顯式的，也能用 stub ctx 在 Node 驗證。
- `STATE` 是程式碼列舉（狀態機的值），留在 `index.html`；其餘常數與內容表都在 `src/data/`。

## 開發與驗證

三支工具，都不需要建置：

```bash
node tools/verify-data.mjs    # 資料層閘門（5 項，純 Node、秒級）
node tools/verify-game.mjs    # 遊戲行為與平台細節（31 項，Playwright）
#   PW_MODULE=/path/to/playwright/index.js node tools/verify-game.mjs
#   PROBE_URL=https://cormort.github.io/tank-battle/ node tools/verify-game.mjs   # 打遠端
```

### `verify-data.mjs`（資料層閘門）

| 組 | 檢查 | 抓到的 bug 類型 |
| :--- | :--- | :--- |
| A 等價 | `src/data` 的每張表與 `tools/data-baseline.json`（抽離前從 index.html 擷取）逐值相同；刻意修正需明示理由並逐列驗證 | 抽資料層時不小心改到數值 |
| B schema | 必填欄位／型別、`WEAPON_TREE.id === key`、四條進化鏈長度 4、商店價格 > 0… | 16 個武器條目缺 `id` 導致四條流派不可玩 |
| C 可達性 | 每個詞綴／事件／商店類型／道具／特殊敵人都有處理與生成路徑 | `'SUMMON'` 與 `'SUMMONER'` 拼字不符、五種特殊敵人有 AI 卻沒有生成端 |
| D 死欄位 | 資料表每個葉節點都要有讀取端 | `POWER_UPS.duration`、`MAP_EVENTS.effect`、`STARTER_WEAPONS`、`SURGE.deactivate` 這些「宣告了卻沒接線」 |

> **D 的已知限制**：掃描是「以欄位名找讀取端」，同名欄位在別處被讀取就會算通過
> （例如新增一個道具的 `duration` 會被 `MAP_EVENTS.duration` 的讀取掩蓋）。
> 它抓的是「整個欄位名沒人用」，無法判斷「這一張表的這一個欄位沒人用」。

### `verify-game.mjs`（行為與平台）

31 項：A 主玩法（武器進化鏈、商店扣分時機、BARRIER 時效、BOOST 方向、子彈壽命回收、
關卡結算與 BOSS 出生閘門、菁英詞綴）、B 行動裝置與輸入（手機橫向可玩、DPR、觸控目標、
失焦放開輸入與自動暫停、Space 對聚焦按鈕有效、例外不凍結遊戲）、
C 效能（老鷹離屏快取、sprite 實例快取、粒子批次、NIGHT 漸層重用、音效發聲上限、F3 面板）、
E 資料接線（SURGE deactivate、空投真的掉寶、FREEZING 凍緩、特殊敵人生成、bomb/mine 傷害）。

### 遊戲內建除錯鉤子

- `?bot`：把內部符號掛到 `window.__T`（`G`／`STATE`／`Pool`／`Tank`／資料表／供測試呼叫的函式）
- `?speed=N`：加速模擬（1–20 倍）
- `?mute` / `?bot`：靜音

> 註：`index.html` 改成 ES module 之後，頂層宣告不再是全域變數；驗證工具需要的符號
> 一律由檔案尾端的 `?bot` 區塊掛到 `window.__T`（見「除錯鉤子」段落）。
