(() => {
  'use strict';
  if (window.top !== window) return;

  const STORE_KEY = 'tecState';
  const DEFAULTS = { x: null, y: null, w: 340, h: 420, alpha: 0.35, blur: 0, visible: true };
  const MIN_W = 220;
  const MIN_H = 160;
  const RESERVED = new Set([
    'directory', 'videos', 'settings', 'subscriptions', 'inventory', 'wallet', 'drops',
    'friends', 'messages', 'downloads', 'turbo', 'prime', 'jobs', 'p', 'search', 'login',
    'signup', 'u', 'moderator', 'dashboard', 'popout', 'embed', 'clips', 'team', 'store'
  ]);

  // Usamos el popout: 7TV/BTTV lo reconocen (el embed no).
  const chatUrl = (ch) =>
    `https://www.twitch.tv/popout/${encodeURIComponent(ch)}/chat?darkpopout`;

  let state = { ...DEFAULTS };
  let currentChannel = null;

  // ---------- DOM ----------
  const root = document.createElement('div');
  root.id = 'tec-root';
  root.innerHTML = `
    <div class="tec-win">
      <div class="tec-bar">
        <span class="tec-title">Chat</span>
        <button class="tec-btn tec-bright" type="button" title="Opacidad del chat" aria-label="Opacidad del chat" aria-expanded="false">
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
            <circle cx="10" cy="10" r="3.4" fill="currentColor"/>
            <path d="M10 2v2.2M10 15.8V18M2 10h2.2M15.8 10H18M4.3 4.3l1.6 1.6M14.1 14.1l1.6 1.6M15.7 4.3l-1.6 1.6M5.9 14.1l-1.6 1.6"/>
          </svg>
        </button>
      </div>
      <div class="tec-pop" hidden>
        <label class="tec-row">
          <span class="tec-lbl">Opacidad</span>
          <input class="tec-alpha" type="range" min="5" max="90">
          <span class="tec-val tec-alpha-val">35%</span>
        </label>
        <label class="tec-row">
          <span class="tec-lbl">Desenfoque</span>
          <input class="tec-blur" type="range" min="0" max="20" title="Más desenfoque consume más GPU">
          <span class="tec-val tec-blur-val">Off</span>
        </label>
      </div>
      <iframe class="tec-frame" title="Chat de Twitch" allow="clipboard-write"></iframe>
      <div class="tec-grip"></div>
    </div>
  `;
  const win = root.querySelector('.tec-win');
  const bar = root.querySelector('.tec-bar');
  const frame = root.querySelector('.tec-frame');
  const grip = root.querySelector('.tec-grip');
  const alphaInput = root.querySelector('.tec-alpha');
  const alphaVal = root.querySelector('.tec-alpha-val');
  const blurInput = root.querySelector('.tec-blur');
  const blurVal = root.querySelector('.tec-blur-val');
  const brightBtn = root.querySelector('.tec-bright');
  const pop = root.querySelector('.tec-pop');

  // ---------- Estado persistente ----------
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { chrome.storage.local.set({ [STORE_KEY]: state }); } catch (_) { /* contexto invalidado */ }
    }, 250);
  }

  function getChannel() {
    const seg = location.pathname.split('/')[1];
    if (!seg) return null;
    const ch = seg.toLowerCase();
    return RESERVED.has(ch) || !/^\w{2,25}$/.test(ch) ? null : ch;
  }

  function playerContainer() {
    return document.querySelector('[data-a-target="video-player"]') ||
           document.querySelector('.video-player');
  }

  // ---------- Layout ----------
  function layout() {
    const parent = root.parentElement;
    if (!parent) return;
    const cw = parent.clientWidth;
    const ch = parent.clientHeight;
    if (!cw || !ch) return;

    state.w = Math.min(Math.max(state.w, MIN_W), cw);
    state.h = Math.min(Math.max(state.h, MIN_H), ch);
    if (state.x === null) state.x = cw - state.w - 16;
    if (state.y === null) state.y = Math.max(16, ch - state.h - 90);
    state.x = Math.min(Math.max(state.x, 0), cw - state.w);
    state.y = Math.min(Math.max(state.y, 0), ch - state.h);

    win.style.left = state.x + 'px';
    win.style.top = state.y + 'px';
    win.style.width = state.w + 'px';
    win.style.height = state.h + 'px';
  }

  function applyState() {
    root.style.setProperty('--tec-a', String(state.alpha));
    alphaInput.value = String(Math.round(state.alpha * 100));
    alphaVal.textContent = Math.round(state.alpha * 100) + '%';
    applyBlur();
    root.classList.toggle('tec-hidden', !state.visible);
    if (!state.visible) setPopOpen(false);
    // El chat solo se muestra con el reproductor en pantalla completa.
    root.classList.toggle('tec-nofs', !document.fullscreenElement);
    updateControlButton();
    layout();
  }

  // ---------- Botón en la barra de controles del reproductor ----------
  const CHAT_ICON =
    '<svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true">' +
    '<path d="M3 3h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 3.5V14H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/></svg>';

  function updateControlButton() {
    const btn = document.getElementById('tec-toggle');
    if (!btn) return;
    btn.hidden = !document.fullscreenElement; // solo se ofrece en pantalla completa
    btn.classList.toggle('tec-on', state.visible);
    btn.setAttribute('aria-pressed', String(state.visible));
  }

  function ensureControlButton() {
    const right = document.querySelector('.player-controls__right-control-group');
    if (!right) return;
    let btn = document.getElementById('tec-toggle');
    if (btn && btn.parentElement === right) return;
    if (btn) btn.remove(); // React pudo recrear la barra: lo volvemos a colocar

    btn = document.createElement('button');
    btn.id = 'tec-toggle';
    btn.type = 'button';
    btn.title = 'Chat de cristal (Alt+C)';
    btn.setAttribute('aria-label', 'Mostrar u ocultar el chat de cristal');
    btn.innerHTML = CHAT_ICON;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      btn.blur(); // evita que la barra espaciadora lo vuelva a activar
      setVisible(!state.visible);
    });

    // Justo antes del botón de pantalla completa (o su contenedor directo)
    const fsBtn = right.querySelector('[data-a-target="player-fullscreen-button"]');
    let anchor = fsBtn;
    while (anchor && anchor.parentElement !== right) anchor = anchor.parentElement;
    if (anchor) right.insertBefore(btn, anchor);
    else right.appendChild(btn);
    updateControlButton();
  }

  // ---------- Montaje (normal / pantalla completa) ----------
  function mount() {
    const fs = document.fullscreenElement;
    let parent;
    if (fs && fs.tagName !== 'VIDEO') {
      // Si el elemento a pantalla completa ya contiene el overlay, no hace falta moverlo
      // (mover un iframe lo recarga).
      if (fs.contains(root)) return true;
      parent = fs;
    } else {
      parent = playerContainer();
    }
    if (!parent) return false;
    if (root.parentElement !== parent) {
      if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
      parent.appendChild(root);
      layout();
    }
    return true;
  }

  function tick() {
    const ch = getChannel();
    if (!ch) {
      if (root.isConnected) root.remove();
      currentChannel = null;
      return;
    }
    ensureControlButton();
    if (!mount()) return;
    if (ch !== currentChannel) {
      currentChannel = ch;
      frame.src = chatUrl(ch);
    }
  }

  // ---------- Interacciones ----------
  function setVisible(v) {
    if (v && !document.fullscreenElement) return; // solo funciona en pantalla completa
    state.visible = v;
    applyState();
    save();
  }

  // Con 0 se quita el filtro por completo (ni siquiera blur(0)): es lo más barato para la GPU.
  function applyBlur() {
    const b = Number(state.blur) || 0;
    const v = b > 0 ? `blur(${b}px) saturate(1.4)` : 'none';
    win.style.backdropFilter = v;
    win.style.webkitBackdropFilter = v;
    blurInput.value = String(b);
    blurVal.textContent = b > 0 ? b + 'px' : 'Off';
  }
  blurInput.addEventListener('input', () => {
    state.blur = Number(blurInput.value);
    applyBlur();
    save();
  });

  // Botón de brillo: abre/cierra el control de opacidad del cristal.
  function setPopOpen(open) {
    pop.hidden = !open;
    brightBtn.setAttribute('aria-expanded', String(open));
    brightBtn.classList.toggle('tec-active', open);
  }
  brightBtn.addEventListener('click', () => setPopOpen(pop.hidden));
  alphaInput.addEventListener('input', () => {
    state.alpha = Number(alphaInput.value) / 100;
    root.style.setProperty('--tec-a', String(state.alpha));
    alphaVal.textContent = alphaInput.value + '%';
    save();
  });
  // Se cierra al hacer clic fuera, o al entrar en el iframe del chat (la ventana pierde el foco).
  document.addEventListener('pointerdown', (e) => {
    if (!pop.hidden && !e.target.closest('.tec-pop, .tec-bright')) setPopOpen(false);
  }, true);
  window.addEventListener('blur', () => setPopOpen(false));

  function startDrag(el, onMove) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.tec-btn, .tec-alpha')) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const sx = e.clientX, sy = e.clientY;
      const start = { ...state };
      const move = (ev) => { onMove(ev.clientX - sx, ev.clientY - sy, start); layout(); };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        save();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }
  startDrag(bar, (dx, dy, s) => { state.x = s.x + dx; state.y = s.y + dy; });
  startDrag(grip, (dx, dy, s) => { state.w = s.w + dx; state.h = s.h + dy; });

  // Atajo Alt+C
  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyC') {
      e.preventDefault();
      setVisible(!state.visible);
    }
  });

  document.addEventListener('fullscreenchange', () => {
    mount();
    // Al salir de pantalla completa el chat se desactiva.
    if (!document.fullscreenElement && state.visible) {
      state.visible = false;
      save();
    }
    applyState();
  });
  window.addEventListener('resize', layout);
  new ResizeObserver(layout).observe(document.documentElement);

  // ---------- Arranque ----------
  function start() {
    if (!document.fullscreenElement) state.visible = false;
    applyState();
    tick();
    // Twitch es una SPA: vigilamos cambios de canal y de DOM.
    setInterval(tick, 1000);
  }

  try {
    chrome.storage.local.get(STORE_KEY, (res) => {
      state = { ...DEFAULTS, ...(res && res[STORE_KEY]) };
      delete state.ghost; // opción retirada; limpia valores guardados antiguos
      start();
    });
  } catch (_) {
    start();
  }
})();
