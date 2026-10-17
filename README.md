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
index.html          遊戲本體（<script type="module">，直接服務即可 —— Pages 不需要建置）
dist/index.html     單檔打包（由 tools/build-single-file.mjs 產生；離線／file:// 用）
src/core/           執行期核心
  rng.js              可重現亂數（xorshift32；?seed=N）
  effects.js          時效系統：所有有持續時間的效果集中在這裡，只有一個 tick 進入點
  state.js            狀態機：7 個狀態 + 轉移白名單（未宣告的轉移會留下警告）
src/render/         渲染層
  tiles.js            地形與基地圖磚（依賴注入 TILE／renderScale／doc；老鷹有離屏快取）
  sprites.js          光暈精靈 glowCanvas（顏色 → 離屏畫布，快取重用）
  effects.js          粒子／生成特效／分數彈出／子彈（依賴注入 ctx／pools）
src/ui/             UI 層
  hud.js              HUD 更新（依賴注入元素集合／狀態取值器／fx／資料表）
  screens.js          畫面流程：標題／暫停／商店／接關／結束／升級三選一（依賴注入 doc／hooks）
src/platform/       平台層（純函式，Node 可測；不碰遊戲內部狀態）
  input.js            鍵盤／觸控 → intent；放開所有輸入只有一個實作
  viewport.js         DPR 倍率、觸控裝置判定、canvas backing store（離屏畫布貼回時須指定 W×H，否則高 DPR 會被放大兩次）
  audio.js            音效與 BGM（Web Audio）；DOM 與遊戲狀態用 hook／rng 注入
  lifecycle.js        失去焦點／切到背景／回到前景的事件 → 意圖對應（可 unbind）
  touch-ui.js         螢幕搖桿與 FIRE 鍵（依賴注入：touch／getConfig／isMobile／doc／win）
src/data/           資料層：唯一來源，這裡改數值就是改遊戲
  config.js           CONFIG（畫布、子彈、粒子、池、AI、玩法）
  weapons.js          四條流派樹、射擊參數、起始武器、掉落池
  upgrades.js         被動／主動技能
  pickups.js          道具與掉落池
  enemies.js          菁英詞綴、特殊敵人類型
  shop.js             商店品項
  events.js           Director 事件（工廠 + 注入 ctx）與地圖事件
  schema.js           必填欄位、型別、進度鏈、可達性規則
tools/              驗證與量測工具（Node + Playwright）
  verify-core.mjs     核心／平台層／渲染／UI 單元測試（91 項，純 Node）
  verify-data.mjs     資料層閘門（等價／schema／可達性／死欄位，5 項，純 Node）
  verify-replay.mjs   確定性與 replay（seed + 輸入 → checksum，12 項）
  verify-bundle.mjs   打包版與模組版行為等價（7 項）
  verify-game.mjs     遊戲行為與平台細節（48 項）
  profile.mjs         效能：update／issue／光柵分開量 + draw call 次數 + CPU hot
  render-hash.mjs     畫面指紋：渲染改動前後是否逐像素相同（A/B 用，不是 CI 基準）
```

`index.html` 只 import 資料層；資料不再內嵌。**不需要建置流程**（原生 ESM，GitHub Pages 直接支援）。

### 資料層的邊界

- 資料檔不得 import 遊戲內部。Director 事件需要執行期物件（`G`／`Tank`／`W`…）時，
  由呼叫端以 getter 注入（`makeDirectorEvents(ctx)`）—— 依賴因此是顯式的，也能用 stub ctx 在 Node 驗證。
- 狀態列舉的唯一來源是 `src/core/state.js` 的 `STATES`（`index.html` 只做 `const STATE = STATES;` 別名）。

## 建置（選用）

Pages 直接服務 `index.html` 的 ESM 模組即可，**不需要建置**。若需要單檔（離線、`file://`、
只要一個請求），用零依賴的內聯器產生 `dist/index.html`：

```bash
node tools/build-single-file.mjs          # 產出 dist/index.html
node tools/build-single-file.mjs --check  # 只檢查是否需要重建（CI 用，離開碼 1 = 需要重建）
```

內聯器只處理相對路徑的具名匯入（含別名與 `export … from` 的 re-export 鏈），並有兩道防線：
打包後不得殘留模組語法、**頂層宣告不得同名**（內聯後共用一個作用域，`
detectMobile` 這種碰撞會讓別名指向自己造成無限遞迴 —— 實際踩過）。

## 開發與驗證

七支工具，都不需要建置（前五支是閘門，後兩支是「改之前先量」的量測工具）：

```bash
node tools/verify-core.mjs    # 核心／平台層／渲染／UI 單元測試（91 項，純 Node、秒級）
node tools/verify-data.mjs    # 資料層閘門（5 項，純 Node、秒級）
node tools/verify-replay.mjs  # 確定性與 replay（12 項）
#   PROBE_URL=https://cormort.github.io/tank-battle/index.html node tools/verify-replay.mjs   # 對正式站驗
node tools/verify-replay.mjs --record   # 玩法刻意改動後重新錄製基準 replay
node tools/verify-bundle.mjs  # 打包版與模組版行為等價（7 項，Playwright）
node tools/verify-game.mjs    # 遊戲行為與平台細節（48 項，Playwright）
#   PW_MODULE=/path/to/playwright/index.js node tools/verify-game.mjs
#   PROBE_URL=https://cormort.github.io/tank-battle/ node tools/verify-game.mjs   # 打遠端

node tools/profile.mjs        # 效能：update／issue／光柵 分開量，附 draw call 次數與 CPU hot（Playwright）
node tools/render-hash.mjs    # 畫面指紋：渲染改動前後是不是「逐像素相同」（Playwright）
```

需要 Playwright 的那幾支先 `npm ci && npx playwright install chromium`；
`package.json` 另有等價的縮寫（`npm run verify`／`verify:browser`／`profile`／`build`）。
`.github/workflows/verify.yml` 在 push 與 PR 上跑同一組閘門（**不含**效能與畫面指紋那兩支，
理由見上一節）。

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

### 平台層（`src/platform/`）

- **input.js**：按鍵 → intent 的對應是一張表；`releaseAll()` 是「放開所有輸入」的唯一實作
  （鍵盤與觸控共用）。主動技能是**邊緣觸發**（`skillPressed`），不再每幀查表、也不會按住連發。
  焦點在 UI 元件上時不攔截 Space／方向鍵的預設行為（否則按鈕無法用 Space 啟動）。
- **viewport.js**：`computeRenderScale()`（上限 2 倍）、`detectMobile()`（以 `pointer: coarse` 為主，
  iPadOS 的 Macintosh UA 因此判得出來）、`applyCanvasScale()`。
- **audio.js**：`makeSound()`／`makeMusic()`；平台層不碰 DOM —— 圖示更新用 `onIconChange`、
  「是否在遊戲中」用 `isPlaying()`、噪音 buffer 的隨機來源用 `rng` 注入。
- **lifecycle.js**：`bindLifecycle({ onLeave, onReturn })` 把 `visibilitychange`／`blur`／`focus`／
  `pointerdown` 對應到「放開輸入＋自動暫停」與「恢復音訊」，並回傳 `unbind()`。
- **touch-ui.js**：`makeTouchInput({ touch, getConfig, isMobile, doc, win })` —— 搖桿與 FIRE 鍵。
  `reset()` 是關鍵介面（失焦／切背景／結算時強制放開）；沒有 DOM 時也不會拋錯。

> 抽 audio 時踩到一個**靜默失效**：噪音 buffer 產生用的 `rnd()` 是 index.html 的變數，
> 搬進模組後不在作用域內，`init()` 拋錯被 `catch` 吞掉 → 整個遊戲沒聲音。
> 修法是明確注入 `rng`，並讓 `catch` 留下 `Sound.error` 與 console 警告；
> `verify-game` 的 F5 與 `verify-core` 的 A1 現在都守住這條。

### 狀態機（`src/core/state.js`）

`G.state` 是狀態機的存取器：既有的 `G.state = X` 不必改寫，但會經過轉移白名單檢查並記錄。
未宣告的轉移**仍然允許**（遊戲不會因為漏寫白名單就卡死）但會登記警告 ——
`verify-game` 的 F1 把真實流程走一遍並要求**警告數為 0**，`verify-core` 的 S8 用純函式驗同一件事。

### 對正式站驗證

兩支工具都支援 `PROBE_URL`，可以直接對生產環境跑：

```bash
PROBE_URL=https://cormort.github.io/tank-battle/index.html node tools/verify-game.mjs    # 48 項行為與平台檢查
PROBE_URL=https://cormort.github.io/tank-battle/index.html node tools/verify-replay.mjs  # seed + 輸入 → checksum 等價
```

replay 那條是「行為等價」最強的證據：正式站跑同一份 replay 得到的 checksum 必須與
`tools/replays/smoke.json` 相同（目前 `4108668566`）—— 也就是說，重寫前後的**遊戲行為逐位相同**。

### `verify-bundle.mjs`（打包驗證）

打包最容易出的錯是「打出來的檔案能開、但行為不一樣」。所以核心檢查是：
**用同一份 replay 跑打包版，checksum 必須與模組版完全相同**（目前皆為 `4108668566`）。
另外檢查打包檔自足（沒有模組語法、沒有相對匯入、載入時不請求任何本地 `.js`）、
不含工具鏈程式碼、`?bot` 除錯介面齊全。

### `verify-replay.mjs`（確定性與 replay）

整局的隨機都走 `src/core/rng.js` 的 seeded 產生器，`?sim` 模式讓 update 只由 `__T.stepTicks()`
推進（真實時間的 rAF 不會交錯），因此 **seed + 輸入序列** 就唯一決定結果，把結果壓成
`__T.gameChecksum()` 後就能比對：

- R1 同一份 replay 跑兩次 → checksum 相同（沒有隱藏的隨機或時間依賴）
- R2 重播結果與 `tools/replays/smoke.json` 記錄一致 → **玩法改動會讓這條紅**（相當於「玩一局」進 CI）
- R3/R4 換 seed、換輸入都要得到不同結果（否則 replay 是假的）
- S1–S4 原始碼層級：沒有 `Math.random()`、沒有與全域 `rnd` 同名的區域變數（會 TDZ）
- X1／X2 **靜態掃描「呼叫了但沒有定義的裸函式」** —— 這是為了抓一個實際上線過的 bug：
  M2 實作「帶道具敵人發光」時呼叫了 `glowCanvas`，但那個 helper 從來不存在 → 每一幀、
  每一隻帶道具的敵人（約 30%）都丟 `ReferenceError`（被主迴圈 try/catch 撐住，所以只是
  畫面後半段畫不出來 + 錯誤橫幅一直顯示，不容易發現）。X2 對已上線的版本跑會直接紅在
  `index.html: glowCanvas()`
- Y **靜態掃描「寫了卻沒有讀取的欄位」** —— 抓的是「整個子系統沒接線」：
  掃到的 `G.mapEvent` 沒有讀取端，追下去才發現整條地圖事件子系統是死碼（見下一節）；
  同一支掃描也揪出 `barrierTimer`、`glowTimer`、`laserLife`、`chainCount`、`iceFriction`、
  `result.triggered`、以及觸控搖桿的 `joyActive`／`joyDx`／`joyDy`。
  宿主物件（canvas 繪圖狀態、DOM 元素屬性）以「接收者別名 + 欄位名」兩層排除，兩者都附理由。
- T1 所有計時／壽命欄位都有遞減端或到期判定（收斂進 `fx` 之後，掃描對象從 19 個降到 13 個） —— 這一類修過兩次：
  `barrierTimer` 永不遞減（拿了 BARRIER 就整局無敵）、`laserLife` 只寫不讀（每次射擊遺留 29 顆永生子彈）。
  掃描接受 `--`、`-= 1`、`Math.max(0, x-1)`、`<= 0` 到期判定、以及 `+= 1`／`(x || 0) + 1` 計數型推進；
  `maxLife` 是分母不是計時器，明確排除。

> 開發時實際踩到兩件事，現在都有斷言守著：`const rnd = Math.random()` 被全域取代成
> `const rnd = rnd()`（自我引用 TDZ），以及真實時間的 rAF 與測試的逐步模擬交錯
> （同樣 seed 卻得到 947 vs 940 幀）。

### `verify-game.mjs`（行為與平台）

48 項：A 主玩法（武器進化鏈、商店扣分時機、BARRIER 時效、BOOST 方向、子彈壽命回收、
關卡結算與 BOSS 出生閘門、菁英詞綴）、B 行動裝置與輸入（手機橫向可玩、DPR、觸控目標、
失焦放開輸入與自動暫停、Space 對聚焦按鈕有效、例外不凍結遊戲）、
C 效能（老鷹離屏快取、sprite 實例快取、粒子批次、NIGHT 漸層重用、音效發聲上限、F3 面板、
沒有全螢幕填色、樹林逐格貼、暫停不重畫、暫停時玩家不消失）、
E 資料接線（SURGE deactivate、空投真的掉寶、FREEZING 凍緩、特殊敵人生成、bomb/mine 傷害）、
F 狀態機與輸入意圖、G 地圖事件（見下）。

> B7／F6 是「例外不凍結遊戲」與「發光敵人畫得出來」這兩條。它們原本用真實時間等 rAF，
> 在慢主機上會變成假紅（實測空頁面 rAF 只有 8.8 fps），現在改成**同步呼叫 `update()`／
> `render()`**：一次 render 一定扣一次 `glowTimer`，`frameCount` 有沒有前進也不再取決於主機速度。

### 效能：怎麼量、量到什麼（`tools/profile.mjs` + `tools/render-hash.mjs`）

先講一個踩過的坑：**headless 的 `requestAnimationFrame` 不可信**。同一台機器上，
空頁面只跑 `rAF` + 一次 `fillRect` 實測只有 **8.8 fps** —— 用它量「遊戲幾幀」會得到
「遊戲掉到 8 fps」的假結論（`verify-game` 的 B7／F6 就因此紅過）。所以量測工具改成
**同步呼叫 `__T.update()`／`__T.render()`** 再計時，並把成本拆成三段：

| 量的是什麼 | 怎麼量 | 意義 |
| :--- | :--- | :--- |
| `update/tick` | 連續呼叫 `update()` N 次的平均 | 純 JS 模擬成本（與 GPU 無關，真機同樣適用） |
| `issue/幀` | 連續呼叫 `render()` M 次的平均 | 呼叫 canvas API 的成本（命令錄製） |
| `paint/幀` | 上述之後補一次 `getImageData` 逼出光柵化 | 真的「填了多少像素」的成本（SwiftShader 下 ≈ 流量） |

三種負載：`normal`（4 敵／12 彈／40 粒子）、`vs`（18 敵／120 彈／400 粒子，割草模式上限）、
`stress`（48 敵／320 彈／800 粒子，超載）。`--save` / `--compare` 用來做前後對比，
`--cpu` 會用 CDP 抓 self-time hot function。

這一輪（同一台機器、DPR 2、SwiftShader）的結果：

| 負載 | 幀總計 | 變化 | fillStyle／幀 |
| :--- | :--- | :--- | :--- |
| normal | 2.867 → **1.413 ms** | **−50.7%** | 84 → 58 |
| vs | 4.407 → **2.840 ms** | **−35.6%** | 688 → 422 |
| stress | 6.520 → **4.730 ms** | **−27.5%** | 1548 → 1015 |

改的是這四件事（全部是「同一個畫面、更少的像素與狀態切換」）：

1. **樹林只貼有樹的格子**。`forestCanvas` 原本每幀整張 1040×1040 貼回（實測 **1.1 ms／幀**），
   而一張地圖通常只有十幾格樹；改成逐格 `drawImage(sub-rect)` 後是 0.14 ms。逐格貼要注意
   抗鋸齒溢出：樹叢的圓形 blob 中心可能落在格子邊界外（`x + size*0.15`、半徑 4 → 往左溢出
   0.1 px），所以四邊各多貼 1 個邏輯像素，否則會少掉一列半透明像素（實測 12 個區塊、每塊
   1 列，肉眼難辨，但「逐像素相同」的驗證就不成立了）。
2. **底色烘進 `staticCanvas`**。黑底（以及 NIGHT 事件的靛藍底色）原本每幀全螢幕填一次
   （0.32 ms），現在在 `cacheStaticMap()` 就烘進背景層；`breakTile()` 也從 `clearRect`
   改成補底色（`clearRect` 會留下透明洞）。NIGHT 開始／結束時才重烘一次。
3. **暫停時不重畫**。暫停時 `frameCount` 不再前進 → 水波相位、履帶相位、發光呼吸全部凍結，
   同一幀的畫面必然完全相同。現在改為同一 `frameCount` 只畫一次（手機上長時間暫停不再
   持續全速重繪）。
4. **粒子顏色只在真的變了才指派 `fillStyle`**。800 顆火花每顆都指派 ≈ 0.32 ms／幀，
   記住上一個顏色後 ≈ 0.22 ms。**刻意不做「分色批次化」**：那會改變粒子重疊時的疊序，
   而分色批次化省下的時間（≈ 0.1 ms）不值得失去「逐像素相同」這個性質。
   （同樣用量的子彈也試過改成 sprite `drawImage`：實測 0.28 → 0.58 ms，**更慢**，所以沒有採用。）

渲染改動怎麼驗證「畫面沒變」：`tools/render-hash.mjs` 把 6 個固定場景（normal／+combo／vs／
night／paused／menu）畫出來，對 `getImageData` 的每個像素算 FNV 指紋。這 6 個場景在改動前後
**指紋全部相同**（唯一的例外是 `paused`：順手修掉「按 P 暫停後自己的坦克當場消失」—— 舊版
`render()` 只在 `PLAYING` 畫玩家，而每一幀都會重畫整片戰場，所以那一格不會被保留下來）：

```bash
node tools/render-hash.mjs --save /tmp/before.json   # 改之前
node tools/render-hash.mjs --compare /tmp/before.json # 改之後：6 個場景都要 SAME
```

> 指紋只保證「同一台機器、同一個 Chromium」的前後比較（字型與 Skia 版本都會影響像素），
> 所以刻意不把 hash 寫進版控當 CI 基準 —— 它是 A/B 工具。玩法等價則由 replay checksum 守
> （`4108668566` 在這一輪的所有改動後仍然不變，代表**遊戲行為逐位相同**）。

### SURGE 事件與 VS 難度曲線：兩個寫入端各改一半

`tools/verify-game.mjs` 的 E1 在這一輪一開始是紅的：SURGE 的 `activate()` 直接改
`G.spawnInterval`（基準值），而 VS 模式的 `updateVSModeDifficulty()` **每 60 tick 就重算一次**
基準值 → 割草模式裡 SURGE 最多只生效 1 秒鐘，事件結束時 `deactivate()` 還會把重算後的値
再乘回去（實測 `18 → 9 → 72`，而不是回到 18）。現在把「基準值」與「事件修飾子」分開：

| 誰 | 擁有什麼 | 寫哪個欄位 |
| :--- | :--- | :--- |
| `startLevel()`／`updateVSModeDifficulty()` | 關卡與難度的生成節奏 | `G.spawnInterval`（基準） |
| `DIRECTOR_EVENTS.SURGE` | 事件的暫時加減速 | `G.spawnIntervalMul`（修飾子） |
| 生成端 | `effectiveSpawnInterval()` | 只讀，回傳 `基準 × 修飾子`（下限 4） |

E1 現在同時斷言三件事：SURGE 期間間隔真的減半、VS 難度重算**不會**吃掉修飾子、事件到期
完全還原。另外 `startLevel()` 會清掉 `directorEvents`（否則上一關的事件會在新關卡開頭
才 life 到期，觸發一次莫名其妙的 `deactivate`）。

### 地圖事件：被「寫入端掃描」揪出的整條死子系統

`MAP_EVENTS` 有 6 種事件、`updateMapEvent()` 有 6 個分支、`drawMapEvent()` 有 6 種畫面，
但 `tools/verify-core.mjs` 的 Y 組（寫了卻沒有讀取的欄位）掃到 `G.mapEvent` 只有寫入端 ——
順著追下去發現：`rollMapEvent()` 的結果只被塞進這個沒人讀的欄位，`activateMapEvent()`
**沒有任何呼叫端**，整條子系統都是死碼（玩家永遠不會遇到任何地圖事件）。

修好之後每一項都有斷言（`verify-game` 的 G 組，全部用 `stepTicks()` 同步推進，不靠 rAF 時序）：

| 事件 | 實作 | 檢查 |
| :--- | :--- | :--- |
| DESERT | `speedMult *= 0.7`（到期還原） | G2：係數 0.7、玩家速度跟著變、到期完全還原 |
| ICE | 放開方向後沿最後方向滑行 14 tick | G3：8 個 tick 都在滑、滑完會停、對照組不會滑 |
| VOLCANIC | 每 90 tick 產生落點並傷害 | G5：落點真的產生 |
| EMP | 場上既有的與事件期間新生成的子彈都減半 | G4：舊子彈 4→2、新子彈用 `bulletSpeed()` 減半、結束後恢復 |
| NIGHT | 全螢幕漸層壓暗（漸層快取） | C4 |
| TOXIC | 每秒扣 0.15 HP | G7：扣血且同一秒只扣一次 |

兩個順手修掉的順序／重複問題（都是這次改動自己踩出來的）：`activateMapEvent()` 原本排在
`deactivateMapEvent()` **之前**，效果會在同一个 `startLevel()` 內被立刻還原；以及同一處有兩份
擲骰（`rollMapEvent()` 與一段複製的 `rnd() < 0.25`）。現在啟動點只有一個，位置在 `deactivate`
之後。

### 遊戲內建除錯鉤子

- `?bot`：把內部符號掛到 `window.__T`（`G`／`STATE`／`Pool`／`Tank`／資料表／供測試呼叫的函式／
  `stepTicks`／`gameChecksum`／`seed`／`rngState`）
- `?sim`：確定性模擬模式（update 只由 `stepTicks()` 推進，replay 測試用）
- `?seed=N`：指定亂數種子（可重現同一局）
- `?speed=N`：加速模擬（1–20 倍）
- `?mute` / `?bot`：靜音

> 註：`index.html` 改成 ES module 之後，頂層宣告不再是全域變數；驗證工具需要的符號
> 一律由檔案尾端的 `?bot` 區塊掛到 `window.__T`（見「除錯鉤子」段落）。
