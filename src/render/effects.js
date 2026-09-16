// 渲染層：粒子、生成特效、分數彈出、子彈（M4）。
//
// 從 index.html 搬過來，依賴改成注入（ctx／pools／getGame／dirs），因此可以用假 context
// 在 Node 驗證「畫了幾次、用了什麼顏色」—— 粒子批次化（固定色 + globalAlpha，不再每顆配
// rgba 字串）就是靠這樣量出來的。

/**
 * @param {{ctx:object, particlesPool:object, bulletsPool:object, getGame:Function,
 *          smokeColor?:string, dirs?:{UP:number,DOWN:number,LEFT:number}}} deps
 */
export function makeEffectRenderer({ ctx, particlesPool, bulletsPool, getGame, smokeColor = '#505050', dirs = { UP: 0, DOWN: 2, LEFT: 3 } }) {
  function drawParticles() {
    const arr = particlesPool.active;
    ctx.save();
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      if (!p.alive || p.type !== 'spark') continue;
      const t = p.life / p.maxLife;
      if (p.color === '#5cd8ff') {
        ctx.fillStyle = t > 0.5 ? '#ffffff' : '#74c0fc';
      } else {
        ctx.fillStyle = t > 0.7 ? '#ffeb50' : t > 0.4 ? '#ff9020' : '#c03030';
      }
      const sz = (p.size + 0.5) | 0;
      ctx.fillRect(p.x | 0, p.y | 0, sz, sz);
    }
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      if (!p.alive || p.type !== 'smoke') continue;
      const a = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = smokeColor;      // 固定色 + globalAlpha（純數值）：不再為每顆煙霧配 rgba 字串
      ctx.globalAlpha = a * 0.5;
      ctx.fillRect(p.x | 0, p.y | 0, p.size | 0, p.size | 0);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawNESSpawnEffect(x, y, size, life, maxLife) {
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

    ctx.save();
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      if (!b.alive) continue;
      const cx = (b.x + b.size / 2) | 0;
      const cy = (b.y + b.size / 2) | 0;
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
