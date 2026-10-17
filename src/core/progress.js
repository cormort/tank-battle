// 跨局進度：圖鑑擊殺數、最高關卡、最高連擊、選用的坦克、已解鎖成就。
//
// 存在 storage（瀏覽器是 localStorage；?bot 驗證模式傳記憶體版，不污染玩家存檔）。
// 讀寫都包 try/catch：隱私模式或被封鎖時照樣能玩，只是不會記住。

const KEY = 'tankBattle.progress.v1';

export function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

/**
 * @param {{storage:object, entries:Array, skins:Array, achievements:Array, onUnlock?:Function}} deps
 *   onUnlock(kind, item)：kind = 'codex' | 'skin' | 'achievement'
 */
export function makeProgress({ storage, entries, skins, achievements, onUnlock = () => {} }) {
  const entryById = new Map(entries.map((e) => [e.id, e]));
  let s = { kills: {}, totalKills: 0, bestLevel: 1, bestCombo: 0, skin: 'tank_player', achievements: {} };
  try { Object.assign(s, JSON.parse(storage.getItem(KEY) || '{}')); } catch { /* 壞存檔：從頭開始 */ }

  const save = () => { try { storage.setItem(KEY, JSON.stringify(s)); } catch { /* 存不了就算了 */ } };
  const entryUnlocked = (id) => entryById.has(id) && (s.kills[id] || 0) >= entryById.get(id).kills;
  const skinUnlocked = (id) => { const k = skins.find((x) => x.id === id); return !!k && s.bestLevel >= k.level; };
  const snapshot = () => ({
    ...s,
    codexUnlocked: entries.filter((e) => entryUnlocked(e.id)).length,
    codexTotal: entries.length,
    skinsUnlocked: skins.filter((k) => skinUnlocked(k.id)).length,
  });
  function checkAchievements() {
    const snap = snapshot();
    for (const a of achievements) {
      if (!s.achievements[a.id] && a.test(snap)) { s.achievements[a.id] = true; onUnlock('achievement', a); }
    }
  }
  /** 套用一次變更，補發新解鎖的坦克與成就，然後存檔（存檔只有一小段 JSON）。 */
  function change(fn) {
    const beforeSkins = new Set(skins.filter((k) => skinUnlocked(k.id)).map((k) => k.id));
    fn();
    for (const k of skins) if (!beforeSkins.has(k.id) && skinUnlocked(k.id)) onUnlock('skin', k);
    checkAchievements();
    save();
  }

  return {
    recordKill(id) {
      change(() => {
        s.totalKills++;
        if (!entryById.has(id)) return;
        const was = entryUnlocked(id);
        s.kills[id] = (s.kills[id] || 0) + 1;
        if (!was && entryUnlocked(id)) onUnlock('codex', entryById.get(id));
      });
    },
    recordLevel(level) { if (level > s.bestLevel) change(() => { s.bestLevel = level; }); },
    recordCombo(n) { if (n > s.bestCombo) change(() => { s.bestCombo = n; }); },
    entryUnlocked,
    entryKills: (id) => s.kills[id] || 0,
    skinUnlocked,
    skin: () => (skinUnlocked(s.skin) ? s.skin : 'tank_player'),
    selectSkin(id) { if (skinUnlocked(id)) { s.skin = id; save(); return true; } return false; },
    achievementUnlocked: (id) => !!s.achievements[id],
    snapshot,
  };
}
