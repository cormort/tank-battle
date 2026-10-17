// 渲染層：粒子、生成特效、分數彈出、子彈（M4）。
//
// 從 index.html 搬過來，依賴改成注入（ctx／pools／getGame／dirs），因此可以用假 context
// 在 Node 驗證「畫了幾次、用了什麼顏色」—— 粒子批次化（固定色 + globalAlpha，不再每顆配
// rgba 字串）就是靠這樣量出來的。

/**
 * @param {{ctx:object, particlesPool:object, bulletsPool:object, getGame:Function,
 *          smokeColor?:string, dirs?:{UP:number,DOWN:number,LEFT:number}}} deps
 */
import { drawRotated } from './wh40k-art.js';

export function makeEffectRenderer({ ctx, particlesPool, bulletsPool, getGame, smokeColor = '#505050', dirs = { UP: 0, DOWN: 2, LEFT: 3 }, art = () => null }) {
  // WH40K 素材版：火花／煙霧改成貼圖（alpha 隨壽命淡出）。素材未載入時走下面的原始畫法。
  function drawParticlesArt(sparkImg, smokeImg) {
    const arr = particlesPool.active;
    ctx.save();
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      if (!p.alive || p.type !== 'smoke') continue;
      const sz = p.size * 1.6;
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife) * 0.6;
      ctx.drawImage(smokeImg, p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      if (!p.alive || p.type !== 'spark') continue;
      const t = p.life / p.maxLife;
      const sz = p.size * (p.color === '#5cd8ff' ? 2 : 3) * (0.6 + t * 0.6);
      ctx.globalAlpha = Math.min(1, t * 1.4);
      ctx.drawImage(sparkImg, p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
    ctx.restore();
  }

  function drawParticles() {
    const sparkImg = art('spark'), smokeImg = art('smoke');
    if (sparkImg && smokeImg) { drawParticlesArt(sparkImg, smokeImg); return; }
    const arr = particlesPool.active;
    ctx.save();
    // 顏色只在「真的變了」的時候才指派：指派 fillStyle 要解析字串（實測 800 顆火花
    // 每顆都指派一次 ≈ 0.32 ms／幀，改成記住上一個顏色 ≈ 0.22 ms）。
    // 繪製順序完全不變（不像分色批次化那樣會改變重疊時的疊序），所以畫面逐像素相同。
    let lastFill = null;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      if (!p.alive || p.type !== 'spark') continue;
      const t = p.life / p.maxLife;
      const fill = p.color === '#5cd8ff'
        ? (t > 0.5 ? '#ffffff' : '#74c0fc')
        : (t > 0.7 ? '#ffeb50' : t > 0.4 ? '#ff9020' : '#c03030');
      if (fill !== lastFill) { ctx.fillStyle = fill; lastFill = fill; }
      const sz = (p.size + 0.5) | 0;
      ctx.fillRect(p.x | 0, p.y | 0, sz, sz);
    }
    const smokeFill = smokeColor;      // 固定色 + globalAlpha（純數值）：不再為每顆煙霧配 rgba 字串
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      if (!p.alive || p.type !== 'smoke') continue;
      const a = Math.max(0, p.life / p.maxLife);
      if (lastFill !== smokeFill) { ctx.fillStyle = smokeFill; lastFill = smokeFill; }
      ctx.globalAlpha = a * 0.5;
      ctx.fillRect(p.x | 0, p.y | 0, p.size | 0, p.size | 0);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawNESSpawnEffect(x, y, size, life, maxLife) {
    const warp = art('warp');
    if (warp) {
      const t = life / maxLife;                       // 1 → 0：裂隙張開後收束
      const sz = size * 1.6 * Math.sin(Math.PI * Math.min(1, (1 - t) * 1.2 + 0.1));
      ctx.save();
      ctx.globalAlpha = 0.9;
      drawRotated(ctx, warp, x + size / 2, y + size / 2, sz, sz, (maxLife - life) * 0.25);
      ctx.restore();
      return;
    }
    ctx.save();
    const frame = (((maxLife - life) >> 2) % 4);
    const cx = x + size / 2;
    const cy = y + size / 2;
    const r = size / 2;
    ctx.fillStyle = '#ffffff';
    if (frame === 0) {
      ctx.fillRect((cx - 1) | 0, y, 2, size);
      ctx.fillRect(x, (cy - 1) | 0, size, 2);
    } else if (frame === 1) {
      ctx.fillRect((cx - 1) | 0, y, 2, size);
      ctx.fillRect(x, (cy - 1) | 0, size, 2);
      for (let i = -r + 2; i <= r - 2; i += 2) {
        ctx.fillRect((cx + i) | 0, (cy + i) | 0, 2, 2);
        ctx.fillRect((cx + i) | 0, (cy - i) | 0, 2, 2);
      }
    } else if (frame === 2) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, y);    ctx.lineTo(x + size, cy);
      ctx.lineTo(cx, y + size);  ctx.lineTo(x, cy);
      ctx.closePath();
      ctx.stroke();
    } else {
      ctx.fillRect((cx - 3) | 0, (cy - 3) | 0, 6, 6);
    }
    ctx.restore();
  }

  function drawScorePopups() {
    ctx.save();
    ctx.font = '10px "Press Start 2P"';
    ctx.fillStyle = '#ffe680';
    for (let i = 0; i < getGame().scorePopups.length; i++) {
      const p = getGame().scorePopups[i];
      ctx.globalAlpha = p.life / 40;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  }

  function renderBullets() {
    const bullets = bulletsPool.active;
    if (bullets.length === 0) return;

    const shellImg = art('shell'), pImg = art('bullet_player'), eImg = art('bullet_enemy');
    ctx.save();
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      if (!b.alive) continue;
      const cx = (b.x + b.size / 2) | 0;
      const cy = (b.y + b.size / 2) | 0;
      // OMEGA 光束：一排靜止的段（每 15px 一顆、壽命 15 tick）。逐顆貼子彈圖會變成一串彈殼，
      // 這裡每段畫成剛好 15px 的光柱（首尾相接成一條；重疊的話 lighter 會在接縫疊出亮線），外層藍光＋白色核心，隨壽命淡出。
      if (b.laserLife > 0) {
        const a = Math.min(1, b.laserLife / 10);
        const horiz = b.dir !== dirs.UP && b.dir !== dirs.DOWN;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a * 0.45;
        ctx.fillStyle = '#2a6cff';
        if (horiz) ctx.fillRect(cx - 7.5, cy - 5, 15, 10); else ctx.fillRect(cx - 5, cy - 7.5, 10, 15);
        ctx.globalAlpha = a;
        ctx.fillStyle = '#d8f2ff';
        if (horiz) ctx.fillRect(cx - 7.5, cy - 1.5, 15, 3); else ctx.fillRect(cx - 1.5, cy - 7.5, 3, 15);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        continue;
      }
      const img = b.shell ? shellImg : (b.isPlayer ? pImg : eImg);
      if (img) {
        // 素材朝上；方向取速度向量（散彈有斜向），速度為 0 的光束段退回 dir
        const ang = (b.vx || b.vy) ? Math.atan2(b.vy, b.vx) + Math.PI / 2
          : [0, Math.PI / 2, Math.PI, -Math.PI / 2][b.dir] || 0;
        const sz = b.shell ? 18 : 13;
        drawRotated(ctx, img, cx, cy, sz, sz, ang);
        continue;
      }

      // BOSS 砲彈（攻城核心）：比一般子彈大、橘紅色外框 + 引信閃爍，讓玩家有時間離開落點。
      // 一般子彈是 6×6 的 NES 小點，砲彈必須一眼就分得出來（否則「範圍傷害」完全來不及反應）。
      if (b.shell) {
        const blink = (b.fuse >> 2) & 1;
        ctx.fillStyle = '#000';
        ctx.fillRect(cx - 5, cy - 5, 10, 10);
        ctx.fillStyle = blink ? '#ffcc33' : '#ff4422';
        ctx.fillRect(cx - 4, cy - 4, 8, 8);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cx - 2, cy - 2, 2, 2);
        continue;
      }
      ctx.fillStyle = '#000';
      ctx.fillRect(cx - 3, cy - 3, 6, 6);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - 2, cy - 2, 4, 4);
      if (b.dir === dirs.UP)         ctx.fillRect(cx - 1, cy - 4, 2, 2);
      else if (b.dir === dirs.DOWN)  ctx.fillRect(cx - 1, cy + 2, 2, 2);
      else if (b.dir === dirs.LEFT)  ctx.fillRect(cx - 4, cy - 1, 2, 2);
      else                       ctx.fillRect(cx + 2, cy - 1, 2, 2);
    }
    ctx.restore();
  }

  return { drawParticles, drawNESSpawnEffect, drawScorePopups, renderBullets };
}
