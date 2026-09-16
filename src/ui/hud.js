// UI 層：HUD（M4）。
//
// 從 index.html 搬過來，依賴改成注入（元素集合／狀態取值器／時效系統／資料表），
// 因此可以在 Node 用假 DOM 驗證「分數、生命、狀態晶片字串」的組法。

/**
 * @param {{els:object, getGame:Function, fx:object, tables:{weapons:object, activeSkills:Array}, config:object}} deps
 */
export function makeHud({ els, getGame, fx, tables, config }) {
  function update() {
    els.score.textContent = getGame().score;
    els.lives.textContent = '♥'.repeat(Math.max(0, Math.ceil(getGame().playerStats.hp)));
    els.enemies.textContent = getGame().maxEnemies - getGame().enemiesSpawned + getGame().aliveEnemies;

    if (getGame().isVSMode) {
      els.level.textContent = 'SURVIVAL';
      els.level.className = 'value level vs-alert';
    } else {
      els.level.textContent = getGame().level + (getGame().level % config.GAMEPLAY.BOSS_LEVEL_INTERVAL === 0 ? '(BOSS)' : '');
      els.level.className = 'value level';
    }

    const chips = [];
    const weapon = getGame().playerStats.weapon || 'NORMAL';
    if (weapon !== 'NORMAL') {
      const wp = tables.weapons[weapon];
      chips.push(`<span class="power-chip" style="border-color:${wp ? wp.color : '#5cd8ff'}">${weapon}</span>`);
    }
    if (getGame().playerStats.pierce) chips.push(`<span class="power-chip">PIERCE</span>`);
    if (getGame().playerStats.speedMult > 1) chips.push(`<span class="power-chip">SPEED+</span>`);
    if (getGame().playerStats.shopFireRateBonus > 0) chips.push(`<span class="power-chip">RAPID+</span>`);
    if (getGame().playerStats.passives.length > 0) {
      chips.push(`<span class="power-chip" style="background:#330033;border-color:#ff00ff">P${getGame().playerStats.passives.length}</span>`);
    }
    if (getGame().playerStats.activeSkill) {
      const cdPct = Math.floor((fx.left('skill') / 30) * 100);
      const skillDef = tables.activeSkills.find((s) => s.id === getGame().playerStats.activeSkill);
      const keyLabel = skillDef && skillDef.key ? skillDef.key.replace('Key', '') : 'Q';
      chips.push(`<span class="power-chip" style="background:#003300;border-color:#00ff00">[${keyLabel}]${getGame().playerStats.activeSkill}${cdPct > 0 ? '(' + cdPct + ')' : ''}</span>`);
    }
    if (fx.has('boost')) {
      chips.push(`<span class="power-chip" style="background:#ff0000;border-color:#ff6600">OVERCLOCK</span>`);
    }
    if (fx.has('wall')) {
      const sec = Math.ceil(fx.left('wall') / 60);
      chips.push(`<span class="power-chip" style="background:#444;border-color:#888">🧱${sec}s</span>`);
    }
    if (fx.has('freeze')) {
      const sec = Math.ceil(fx.left('freeze') / 60);
      chips.push(`<span class="power-chip" style="background:#004;border-color:#00ffff">⏱️${sec}s</span>`);
    }
    chips.push(`<span class="power-chip" style="background:#300;border-color:#f88">❤️${getGame().continues}</span>`);
    els.power.innerHTML = chips.join('');
  }

  return { update };
}
