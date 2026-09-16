// UI 層：畫面流程（M4）—— 暫停／商店／接關／結束。
//
// 這些函式是「畫面流程」：操作 DOM，也會改動遊戲狀態（`G.state`）或呼叫玩法函式
// （買東西、重開、接關）。所以依賴全部用注入：`doc`／`getGame()`／`states`／`tables`／`hooks`，
// 讓 UI 層不必直接認識遊戲內部，也讓「按了某個按鈕會發生什麼」在呼叫端一眼看得出來。

/**
 * @param {{
 *   doc: object, getGame: Function, states: object,
 *   tables: { shopItems: Array },
 *   hooks: {
 *     getShopPrice: Function, buyItem: Function, restartGame: Function, continueGame: Function,
 *     updateMobileControls: Function, playSound: Function, playMusic: Function, jingleGameOver: Function,
 *   },
 * }} deps
 */
export function makeScreens({ doc, getGame, states, tables, hooks }) {
  function togglePause() {
    const game = getGame();
    const ov = doc.getElementById('overlay');
    if (game.state === states.PLAYING) {
      game.state = states.PAUSED;
      ov.classList.add('translucent');
      ov.classList.remove('hidden');
      ov.innerHTML = `<h2>PAUSED</h2><p>按 <b>P</b> 繼續</p>
        <button class="start-btn" id="resumeBtn" style="margin-top:15px;">繼續</button>
        <button class="start-btn" id="shopBtn" style="margin-top:10px;background:linear-gradient(180deg,rgba(255,215,0,0.08),rgba(255,170,0,0.02));border-color:#ffd700;color:#ffd700;">商店 (B)</button>`;
      doc.getElementById('resumeBtn').onclick = togglePause;
      doc.getElementById('shopBtn').onclick = () => { togglePause(); openShop(); };
      doc.getElementById('resumeBtn').focus();
      hooks.playSound(440, 0.05, 0.2, 'square');
    } else if (game.state === states.PAUSED) {
      game.state = states.PLAYING;
      ov.classList.remove('translucent');
      ov.classList.add('hidden');
      hooks.playSound(440, 0.05, 0.2, 'square');
    }
  }

  function openShop() {
    const game = getGame();
    if (game.state !== states.PLAYING) return;
    game.state = states.SHOP;
  
    const ov = doc.getElementById('overlay');
    ov.classList.remove('hidden');
    ov.classList.remove('translucent');
  
    let shopHTML = `<h1>🏪 商店</h1>
      <p style="color:#ffd700;margin-bottom:15px;">分數: ${game.score}</p>
      <div class="shop-grid">`;
  
    for (const item of tables.shopItems) {
      const price = hooks.getShopPrice(item.price);
      const canAfford = game.score >= price;
      const disabled = !canAfford || (item.type === 'pierce' && game.playerStats.pierce);
      const btnClass = disabled ? 'shop-item disabled' : 'shop-item';
      shopHTML += `
        <div class="${btnClass}" data-id="${item.id}" ${disabled ? 'style="opacity:0.4;pointer-events:none;"' : ''}>
          <div style="font-size:24px;">${item.icon}</div>
          <div class="card-title" style="color:${item.color}">${item.name}</div>
          <div class="card-desc">${item.desc}</div>
          <div style="color:#ffd700;font-size:9px;margin-top:5px;">💰 ${price}</div>
        </div>
      `;
    }
  
    shopHTML += `</div>
      <button class="start-btn" id="closeShopBtn" style="margin-top:15px;background:#333;border-color:#666;color:#aaa;">❌ 退出商店</button>
      <p style="margin-top:10px;color:#888;font-size:8px;">按 <b>B</b> 或 <b>ESC</b> 關閉商店</p>`;
  
    ov.innerHTML = shopHTML;
  
    doc.querySelectorAll('.shop-item').forEach(el => {
      el.onclick = () => hooks.buyItem(el.dataset.id);
    });
  
    const closeBtn = doc.getElementById('closeShopBtn');
    if (closeBtn) closeBtn.onclick = closeShop;
  }

  function closeShop() {
    const game = getGame();
    game.state = states.PLAYING;
    doc.getElementById('overlay').classList.add('hidden');
  }

  function showGameOver() {
    const game = getGame();
    game.state = states.GAMEOVER;
    hooks.jingleGameOver();
    hooks.playMusic('GAMEOVER');
    if (game.continues > 0) showContinuePrompt();
    else showFinalGameOver();
  }

  function showContinuePrompt() {
    const game = getGame();
    const ov = doc.getElementById('overlay');
    ov.classList.remove('hidden');
    ov.innerHTML = `<h2>CONTINUE?</h2>
      <p>剩 <span style="color:#ffd700;">${game.continues}</span> 次接關</p>
      <p style="color:#888; font-size:8px; margin-top:6px;">分數 + 升級保留 · 從本關重啟</p>
      <div style="display:flex; gap:14px; margin-top:22px; flex-wrap:wrap; justify-content:center;">
        <button class="start-btn" id="continueBtn">CONTINUE</button>
        <button class="start-btn" id="quitBtn" style="border-color:#ff5050; color:#ff5050; text-shadow:0 0 8px rgba(255,80,80,0.5);">QUIT</button>
      </div>`;
    const cb = doc.getElementById('continueBtn');
    cb.onclick = hooks.continueGame;
    doc.getElementById('quitBtn').onclick = showFinalGameOver;
    setTimeout(() => cb.focus(), 0);
    hooks.updateMobileControls();
  }

  function showFinalGameOver() {
    const game = getGame();
    const ov = doc.getElementById('overlay');
    ov.classList.remove('hidden');
    ov.innerHTML = `<h2>SYSTEM FAILURE</h2>
      <p>SCORE: <span style="color:#ffd700;">${game.score}</span></p>
      <p>LEVEL: <span style="color:#6cc3ff;">${game.level}</span></p>
      <button class="start-btn" id="restartBtn">REBOOT</button>`;
    const rb = doc.getElementById('restartBtn');
    rb.onclick = () => { hooks.playMusic('MENU'); hooks.restartGame(); };
    setTimeout(() => rb.focus(), 0);      // 讓 Enter/Space 可以直接重開（配合 preventDefault 收斂）
    hooks.updateMobileControls();
  }

  /**
   * 升級三選一：只負責畫卡片與回報選擇（選卡後的規則在遊戲層的 applyUpgrade）。
   * @param {Array} options generateUpgradeOptions() 的結果
   * @param {Function} onPick 被選中的選項
   */
  function renderUpgrade(options, onPick) {
    const game = getGame();
    game.state = states.UPGRADE;
    hooks.jingleLevelClear();
    hooks.stopMusic();
    const ui = doc.getElementById('upgradeUI');
    const container = doc.getElementById('cards');
    ui.classList.remove('hidden');
    container.innerHTML = '';
    options.forEach((opt) => {
      const div = doc.createElement('div');
      div.className = 'upgrade-card';
      div.style.borderColor = opt.color;
      div.style.boxShadow = `0 0 15px ${opt.color}33`;
      div.tabIndex = 0;
      div.setAttribute('role', 'button');
      div.innerHTML = `
        <div style="font-size:24px;margin-bottom:8px;">${opt.icon || '⬆️'}</div>
        <div class="card-title" style="color:${opt.color}">${opt.title}</div>
        <div class="card-desc">${opt.desc}</div>
      `;
      div.onclick = () => onPick(opt);
      div.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(opt); }
      };
      container.appendChild(div);
    });
    setTimeout(() => container.firstChild && container.firstChild.focus(), 0);
  }

  return { togglePause, openShop, closeShop, showGameOver, showContinuePrompt, showFinalGameOver, renderUpgrade };
}
