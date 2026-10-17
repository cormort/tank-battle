// 主選單的「圖鑑 · 坦克 · 成就」畫面。純 DOM，狀態全部來自 progress（src/core/progress.js）。
//
// 未解鎖的圖鑑顯示剪影＋擊殺進度；坦克頁可以點選換裝（只換外觀）；成就頁列出條件與是否達成。

const TABS = [['codex', '📖 圖鑑'], ['skins', '🚜 坦克'], ['achievements', '🏆 成就']];

/**
 * @param {{doc:object, progress:object, entries:Array, skins:Array, achievements:Array, artData:Object<string,string>}} deps
 */
export function makeCodexScreen({ doc, progress, entries, skins, achievements, artData }) {
  let tab = 'codex';
  let open = false;
  const root = () => doc.getElementById('codexUI');
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // 先載 assets/codex/ 的高解析圖（tools/wh40k-process.py 產生）；單檔打包版旁邊沒有這個資料夾，
  // 載入失敗就退回遊戲內嵌的小圖（render() 裡掛 onerror）。
  const img = (id, locked) => artData[id]
    ? `<img src="assets/codex/${esc(id)}.webp" data-art="${esc(id)}" alt="" class="${locked ? 'locked' : ''}" loading="lazy">`
    : '<div class="noimg">?</div>';

  function codexHtml() {
    const groups = [...new Set(entries.map((e) => e.group))];
    const done = entries.filter((e) => progress.entryUnlocked(e.id)).length;
    return `<p class="codex-sum">已解鎖 ${done} / ${entries.length}</p>` + groups.map((g) => `
      <h3>${esc(g)}</h3><div class="codex-grid">${entries.filter((e) => e.group === g).map((e) => {
        const on = progress.entryUnlocked(e.id);
        const k = Math.min(progress.entryKills(e.id), e.kills);
        return `<div class="codex-card${on ? '' : ' is-locked'}">${img(e.id, !on)}
          <div class="codex-name">${on ? esc(e.name) : '？？？'}</div>
          <div class="codex-meta">${on ? esc(e.faction) : `擊毀 ${k} / ${e.kills}`}</div>
          ${on ? '' : `<div class="codex-bar"><i style="width:${(k / e.kills) * 100}%"></i></div>`}</div>`;
      }).join('')}</div>`).join('');
  }

  function skinsHtml() {
    const cur = progress.skin();
    return `<p class="codex-sum">最高抵達第 ${progress.snapshot().bestLevel} 關 · 點選即可換裝（只換外觀）</p>
      <div class="codex-grid">${skins.map((k) => {
        const on = progress.skinUnlocked(k.id);
        return `<button class="codex-card skin${on ? '' : ' is-locked'}${k.id === cur ? ' is-current' : ''}" data-skin="${esc(k.id)}" ${on ? '' : 'disabled'}>
          ${img(k.id, !on)}
          <div class="codex-name">${on ? esc(k.name) : '？？？'}</div>
          <div class="codex-meta">${k.id === cur ? '使用中' : on ? '點選換裝' : `第 ${k.level} 關解鎖`}</div></button>`;
      }).join('')}</div>`;
  }

  function achievementsHtml() {
    const done = achievements.filter((a) => progress.achievementUnlocked(a.id)).length;
    return `<p class="codex-sum">已達成 ${done} / ${achievements.length}</p><div class="ach-list">${achievements.map((a) => {
      const on = progress.achievementUnlocked(a.id);
      return `<div class="ach${on ? ' is-done' : ''}"><span>${on ? '🏆' : '🔒'}</span><b>${esc(a.name)}</b><em>${esc(a.desc)}</em></div>`;
    }).join('')}</div>`;
  }

  function render() {
    const el = root();
    if (!el) return;
    const body = tab === 'codex' ? codexHtml() : tab === 'skins' ? skinsHtml() : achievementsHtml();
    el.innerHTML = `<div class="codex-head"><h2>CODEX</h2><button class="codex-close" id="codexClose" aria-label="關閉">✕</button></div>
      <div class="codex-tabs" role="tablist">${TABS.map(([id, label]) =>
        `<button role="tab" data-tab="${id}" aria-selected="${id === tab}" class="${id === tab ? 'on' : ''}">${label}</button>`).join('')}</div>
      <div class="codex-body">${body}</div>`;
    el.querySelectorAll('img[data-art]').forEach((im) => {
      im.onerror = () => { im.onerror = null; im.src = artData[im.dataset.art]; };
    });
    el.querySelector('#codexClose').onclick = close;
    el.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; render(); }; });
    el.querySelectorAll('[data-skin]').forEach((b) => { b.onclick = () => { if (progress.selectSkin(b.dataset.skin)) render(); }; });
  }

  function close() { open = false; const el = root(); if (el) el.classList.add('hidden'); }
  return {
    open() { open = true; render(); const el = root(); if (el) el.classList.remove('hidden'); },
    close,
    isOpen: () => open,
  };
}
