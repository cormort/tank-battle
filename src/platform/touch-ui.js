// 平台層：觸控 UI（M3）。
//
// 螢幕搖桿與 FIRE 鍵原本寫在 index.html 裡，直接讀寫 `G.touch` 與 `CONFIG.MOBILE`、
// 也直接綁 document/window。抽到平台層後依賴改成注入：
//   touch（狀態物件）、getConfig()、isMobile()、dirs、doc/win。
// 這樣「按著 FIRE 切到別的分頁」這類狀態殘留可以用 stub 在 Node 測（見 verify-core 的 L 組）。
//
// reset() 是關鍵介面：失去焦點／切到背景／結算畫面時必須強制放開搖桿與射擊鍵。

import { DIR as DEFAULT_DIR } from './input.js';

/**
 * @param {{
 *   touch: object,                 // 平台層的觸控狀態（makeTouchState()）
 *   getConfig: Function,           // () => ({ JOYSTICK_MAX_RADIUS, JOYSTICK_DEADZONE })
 *   isMobile: Function,            // () => boolean
 *   dirs?: object,                 // DIR 列舉（預設用 input.js 的）
 *   doc?: object, win?: object,
 * }} options
 */
export function makeTouchInput({
  touch, getConfig, isMobile,
  dirs = DEFAULT_DIR,
  doc = globalThis.document,
  win = globalThis.window,
} = {}) {
  const DIR = dirs;
  const touchInput = {
    joyArea: doc ? doc.getElementById('joystickArea') : null,
    joyBase: doc ? doc.getElementById('joystickBase') : null,
    joyStick: doc ? doc.getElementById('joystickStick') : null,
    fireBtn: doc ? doc.getElementById('fireButton') : null,
  
    joyTouchId: null,
    fireTouchId: null,
    joyCenterX: 0,
    joyCenterY: 0,
  
    init() {
      if (!isMobile()) return;
    
      this._updateJoyCenter();
      win.addEventListener('resize', () => this._updateJoyCenter());
      win.addEventListener('orientationchange', () => setTimeout(() => this._updateJoyCenter(), 200));
    
      this.joyArea.addEventListener('touchstart', this._onJoyStart.bind(this), { passive: false });
      this.joyArea.addEventListener('touchmove', this._onJoyMove.bind(this), { passive: false });
      this.joyArea.addEventListener('touchend', this._onJoyEnd.bind(this), { passive: false });
      this.joyArea.addEventListener('touchcancel', this._onJoyEnd.bind(this), { passive: false });
    
      this.fireBtn.addEventListener('touchstart', this._onFireStart.bind(this), { passive: false });
      this.fireBtn.addEventListener('touchend', this._onFireEnd.bind(this), { passive: false });
      this.fireBtn.addEventListener('touchcancel', this._onFireEnd.bind(this), { passive: false });
    
      doc.addEventListener('gesturestart', e => e.preventDefault());
      doc.addEventListener('dblclick', e => e.preventDefault());
    },
  
    // 強制放開所有觸控狀態（失去焦點、切到背景、或結算畫面時呼叫）。
    // 舊版沒有這個介面，所以「按著 FIRE 切到別的分頁」回來後會持續射擊、搖桿也卡在偏移位置。
    reset() {
      this.joyTouchId = null;
      this.fireTouchId = null;
      touch.dir = -1;
      touch.fire = false;
      if (this.joyStick) { this.joyStick.style.left = '50%'; this.joyStick.style.top = '50%'; }
      if (this.fireBtn) this.fireBtn.classList.remove('pressed');
      if (this.joyBase) {
        // 回到 CSS 的預設位置（橫向 media query 會把它改成 left:20px/bottom:20px，
        // 舊版寫死 left:30px/bottom:30px，橫向放開搖桿時位置會跳一下）
        this.joyBase.style.left = '';
        this.joyBase.style.bottom = '';
      }
      this._updateJoyCenter();
    },

    _updateJoyCenter() {
      // 平台層不假設 DOM 一定存在（元素可能還沒進 DOM、或測試環境沒有 DOM）
      if (!this.joyBase || typeof this.joyBase.getBoundingClientRect !== 'function') return;
      const rect = this.joyBase.getBoundingClientRect();
      this.joyCenterX = rect.left + rect.width / 2;
      this.joyCenterY = rect.top + rect.height / 2;
    },
  
    _onJoyStart(e) {
      e.preventDefault();
      if (this.joyTouchId !== null) return;
    
      const touch = e.changedTouches[0];
      this.joyTouchId = touch.identifier;
    
      const areaRect = this.joyArea.getBoundingClientRect();
      let cx = touch.clientX;
      let cy = touch.clientY;
    
      cx = Math.max(areaRect.left + 70, Math.min(areaRect.right - 70, cx));
      cy = Math.max(areaRect.top + 70, Math.min(areaRect.bottom - 70, cy));
    
      this.joyBase.style.left = (cx - areaRect.left - 65) + 'px';
      this.joyBase.style.bottom = (win.innerHeight - cy - 65) + 'px';
      this.joyCenterX = cx;
      this.joyCenterY = cy;
    
      this._processJoy(touch.clientX, touch.clientY);
    },
  
    _onJoyMove(e) {
      if (this.joyTouchId === null) return;
      e.preventDefault();
    
      for (const t of e.changedTouches) {
        if (t.identifier === this.joyTouchId) {
          this._processJoy(t.clientX, t.clientY);
          break;
        }
      }
    },
  
    _onJoyEnd(e) {
      if (this.joyTouchId === null) return;
    
      for (const t of e.changedTouches) {
        if (t.identifier === this.joyTouchId) {
          e.preventDefault();
          this.joyTouchId = null;
          touch.dir = -1;
          this.joyStick.style.left = '50%';
          this.joyStick.style.top = '50%';
          this.joyBase.style.left = '30px';
          this.joyBase.style.bottom = '30px';
          this._updateJoyCenter();
          break;
        }
      }
    },
  
    _processJoy(touchX, touchY) {
      const dx = touchX - this.joyCenterX;
      const dy = touchY - this.joyCenterY;
      const dist = Math.hypot(dx, dy);
      const maxR = getConfig().JOYSTICK_MAX_RADIUS;
    
      const clampedDist = Math.min(dist, maxR);
      const ratio = dist > 0 ? clampedDist / dist : 0;
      const visualDx = dx * ratio;
      const visualDy = dy * ratio;
    
      this.joyStick.style.left = `calc(50% + ${visualDx}px)`;
      this.joyStick.style.top = `calc(50% + ${visualDy}px)`;
    
      const normDist = clampedDist / maxR;
      if (normDist < getConfig().JOYSTICK_DEADZONE) {
        touch.dir = -1;
      } else {
        touch.dir = Math.abs(dx) > Math.abs(dy)
          ? (dx > 0 ? DIR.RIGHT : DIR.LEFT)
          : (dy > 0 ? DIR.DOWN : DIR.UP);
      }
    },
  
    _onFireStart(e) {
      e.preventDefault();
      if (this.fireTouchId !== null) return;
      this.fireTouchId = e.changedTouches[0].identifier;
      touch.fire = true;
      this.fireBtn.classList.add('pressed');
    },
  
    _onFireEnd(e) {
      if (this.fireTouchId === null) return;
      for (const t of e.changedTouches) {
        if (t.identifier === this.fireTouchId) {
          e.preventDefault();
          this.fireTouchId = null;
          touch.fire = false;
          this.fireBtn.classList.remove('pressed');
          break;
        }
      }
    }
  };
  return touchInput;
}
