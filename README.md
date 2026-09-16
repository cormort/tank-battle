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
src/core/           執行期核心
  rng.js              可重現亂數（xorshift32；?seed=N）
  effects.js          時效系統：所有有持續時間的效果集中在這裡，只有一個 tick 進入點
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
node tools/verify-core.mjs    # 執行期核心單元測試（18 項，純 Node、秒級）
node tools/verify-data.mjs    # 資料層閘門（5 項，純 Node、秒級）
node tools/verify-replay.mjs  # 確定性與 replay（12 項）
node tools/verify-replay.mjs --record   # 玩法刻意改動後重新錄製基準 replay
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

### 時效系統（`src/core/effects.js`）

所有有持續時間的效果（無敵／反應護盾／凍緩／超頻／堡壘／時間凍結／連擊視窗／主動技能冷卻）
都在 `fx` 這個 `EffectSet` 裡，**只有 `update()` 會呼叫 `fx.tick()`**。會這樣收斂是因為原本的
遞減散在 5 個地方，於是出現兩種 bug：`barrierTimer` 只寫不減（拿了 BARRIER 就整局無敵）、
`wallTimer`／`timeFreezeTimer` 的遞減寫在 PLAYING 之外（暫停與商店期間堡壘時間照样流失）。

```js
fx.set('boost', 180);                              // 設定
fx.set('slow', 120, { onExpire: applyPlayerSpeed }); // 到期行為用 callback 宣告
fx.has('invul'); fx.left('wall');                  // 查詢
const expired = fx.tick();                          // 唯一的遞減入口（update() 內）
fx.clearAll();                                      // restartGame() 內，重新開始就清空
```

`tools/verify-core.mjs` 用純 Node 驗證它的語意（到期、`extend` 取較長、callback 時機、快照），
並檢查兩條架構契約：**只有一個 `fx.tick()`**、**已遷移的舊欄位不得再出現**（避免兩份真相）。

### `verify-replay.mjs`（確定性與 replay）

整局的隨機都走 `src/core/rng.js` 的 seeded 產生器，`?sim` 模式讓 update 只由 `__T.stepTicks()`
推進（真實時間的 rAF 不會交錯），因此 **seed + 輸入序列** 就唯一決定結果，把結果壓成
`__T.gameChecksum()` 後就能比對：

- R1 同一份 replay 跑兩次 → checksum 相同（沒有隱藏的隨機或時間依賴）
- R2 重播結果與 `tools/replays/smoke.json` 記錄一致 → **玩法改動會讓這條紅**（相當於「玩一局」進 CI）
- R3/R4 換 seed、換輸入都要得到不同結果（否則 replay 是假的）
- S1–S4 原始碼層級：沒有 `Math.random()`、沒有與全域 `rnd` 同名的區域變數（會 TDZ）
- T1 所有計時／壽命欄位都有遞減端或到期判定（收斂進 `fx` 之後，掃描對象從 19 個降到 13 個） —— 這一類修過兩次：
  `barrierTimer` 永不遞減（拿了 BARRIER 就整局無敵）、`laserLife` 只寫不讀（每次射擊遺留 29 顆永生子彈）。
  掃描接受 `--`、`-= 1`、`Math.max(0, x-1)`、`<= 0` 到期判定、以及 `+= 1`／`(x || 0) + 1` 計數型推進；
  `maxLife` 是分母不是計時器，明確排除。

> 開發時實際踩到兩件事，現在都有斷言守著：`const rnd = Math.random()` 被全域取代成
> `const rnd = rnd()`（自我引用 TDZ），以及真實時間的 rAF 與測試的逐步模擬交錯
> （同樣 seed 卻得到 947 vs 940 幀）。

### `verify-game.mjs`（行為與平台）

31 項：A 主玩法（武器進化鏈、商店扣分時機、BARRIER 時效、BOOST 方向、子彈壽命回收、
關卡結算與 BOSS 出生閘門、菁英詞綴）、B 行動裝置與輸入（手機橫向可玩、DPR、觸控目標、
失焦放開輸入與自動暫停、Space 對聚焦按鈕有效、例外不凍結遊戲）、
C 效能（老鷹離屏快取、sprite 實例快取、粒子批次、NIGHT 漸層重用、音效發聲上限、F3 面板）、
E 資料接線（SURGE deactivate、空投真的掉寶、FREEZING 凍緩、特殊敵人生成、bomb/mine 傷害）。

### 遊戲內建除錯鉤子

- `?bot`：把內部符號掛到 `window.__T`（`G`／`STATE`／`Pool`／`Tank`／資料表／供測試呼叫的函式／
  `stepTicks`／`gameChecksum`／`seed`／`rngState`）
- `?sim`：確定性模擬模式（update 只由 `stepTicks()` 推進，replay 測試用）
- `?seed=N`：指定亂數種子（可重現同一局）
- `?speed=N`：加速模擬（1–20 倍）
- `?mute` / `?bot`：靜音

> 註：`index.html` 改成 ES module 之後，頂層宣告不再是全域變數；驗證工具需要的符號
> 一律由檔案尾端的 `?bot` 區塊掛到 `window.__T`（見「除錯鉤子」段落）。
