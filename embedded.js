// Se ejecuta dentro del iframe del chat (popout).
// 1) Marca el documento como incrustado para que embedded.css haga el fondo transparente.
// 2) Sustituye las palabras que son emotes de 7TV/BTTV por imágenes, porque
//    las extensiones de emotes no suelen ejecutarse dentro de iframes.
(() => {
  'use strict';
  if (window.top === window) return;
  // El área de escritura empieza oculta; un botón inferior la despliega.
  document.documentElement.classList.add('tec-embedded', 'tec-input-collapsed');

  const m = location.pathname.match(/^\/popout\/(\w{2,25})\/chat/i) ||
            location.pathname.match(/^\/embed\/(\w{2,25})\/chat/i);
  if (!m) return;
  const login = m[1].toLowerCase();

  const emotes = new Map(); // nombre -> url
  let ready = false;

  const get = (url) =>
    new Promise((resolve) => {
      const attempt = (left) => {
        try {
          chrome.runtime.sendMessage({ type: 'tec-fetch', url }, (res) => {
            const err = chrome.runtime.lastError;
            if (err) {
              // El service worker puede estar despertando: reintentar una vez.
              if (left > 1) return setTimeout(() => attempt(left - 1), 400);
              console.warn('[TEC] sin respuesta del service worker:', url, err.message);
              return resolve(null);
            }
            if (!res || !res.ok) {
              console.warn('[TEC] fallo al cargar', url, res && res.error);
              return resolve(null);
            }
            resolve(res.data);
          });
        } catch (e) {
          console.warn('[TEC] error enviando mensaje:', e);
          resolve(null);
        }
      };
      attempt(2);
    });

  const add7tv = (emoteList) => {
    for (const e of emoteList || []) {
      if (e && e.name && e.id) emotes.set(e.name, `https://cdn.7tv.app/emote/${e.id}/2x.webp`);
    }
  };
  const addBttv = (list) => {
    for (const e of list || []) {
      if (e && e.code && e.id) emotes.set(e.code, `https://cdn.betterttv.net/emote/${e.id}/2x.webp`);
    }
  };

  // FFZ: respuesta { sets: { <id>: { emoticons: [{ name, urls: {1,2,4} }] } } }
  // Para el global solo valen los sets listados en default_sets.
  const addFfz = (data, onlySets) => {
    if (!data || !data.sets) return;
    const ids = onlySets ? onlySets.map(String) : Object.keys(data.sets);
    for (const sid of ids) {
      const set = data.sets[sid];
      for (const e of (set && set.emoticons) || []) {
        const url = e.urls && (e.urls['2'] || e.urls['1'] || e.urls['4']);
        if (e && e.name && url) emotes.set(e.name, url.startsWith('//') ? 'https:' + url : url);
      }
    }
  };

  // Caché local: la segunda vez que entras a un canal los emotes están al instante.
  const CACHE_KEY = 'tecEmotes_' + login;
  const CACHE_TTL = 60 * 60 * 1000; // 1 hora

  function readCache() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(CACHE_KEY, (r) => resolve((r && r[CACHE_KEY]) || null));
      } catch (_) {
        resolve(null);
      }
    });
  }
  function saveCache() {
    try {
      chrome.storage.local.set({ [CACHE_KEY]: { t: Date.now(), e: [...emotes] } });
    } catch (_) { /* contexto invalidado */ }
  }

  // Aplica lo que haya cargado hasta ahora a los mensajes ya en pantalla.
  function resweep() {
    ready = true;
    sweep(document);
  }

  async function loadEmotes() {
    const cached = await readCache();
    if (cached && Array.isArray(cached.e)) {
      for (const [n, u] of cached.e) emotes.set(n, u);
      resweep();
      console.log(`[TEC] ${emotes.size} emotes desde caché para ${login}`);
      if (Date.now() - cached.t < CACHE_TTL) return;
    }

    // Cada fuente es independiente y se aplica en cuanto llega, sin esperar a las demás.
    const job = (url, handler) =>
      get(url)
        .then((d) => { handler(d); resweep(); })
        .catch((e) => console.warn('[TEC] error procesando', url, e));

    // Los globales no dependen del id del canal: se piden ya, en paralelo con la consulta del id.
    const globals = [
      job('https://7tv.io/v3/emote-sets/global', (d) => add7tv(d && d.emotes)),
      job('https://api.betterttv.net/3/cached/emotes/global', addBttv),
      job('https://api.frankerfacez.com/v1/set/global', (d) => addFfz(d, d && d.default_sets))
    ];

    const channel = get(`https://api.ivr.fi/v2/twitch/user?login=${login}`).then((users) => {
      const id = users && users[0] && users[0].id;
      if (!id) {
        console.warn('[TEC] no se obtuvo el id del canal; solo emotes globales');
        return;
      }
      return Promise.allSettled([
        job(`https://7tv.io/v3/users/twitch/${id}`, (d) => add7tv(d && d.emote_set && d.emote_set.emotes)),
        job(`https://api.frankerfacez.com/v1/room/id/${id}`, (d) => addFfz(d)),
        job(`https://api.betterttv.net/3/cached/users/twitch/${id}`, (d) => {
          if (d) { addBttv(d.channelEmotes); addBttv(d.sharedEmotes); }
        })
      ]);
    });

    await Promise.allSettled([...globals, channel]);
    resweep();
    saveCache();
    console.log(`[TEC] ${emotes.size} emotes cargados para ${login}`);
  }

  const FRAGMENT = '[data-a-target="chat-message-text"]';

  function processFragment(span) {
    if (!ready || span.dataset.tec) return;
    // Solo se marca como procesado si se reemplazó algo; así, los mensajes que no tenían
    // coincidencias se reintentan cuando llegan más emotes.
    const parts = span.textContent.split(/(\s+)/);
    if (!parts.some((w) => emotes.has(w))) return;

    const out = document.createDocumentFragment();
    let buf = '';
    for (const w of parts) {
      const url = emotes.get(w);
      if (url) {
        if (buf) { out.append(buf); buf = ''; }
        const img = document.createElement('img');
        img.className = 'tec-emote';
        img.src = url;
        img.alt = w;
        img.title = w;
        out.append(img);
      } else {
        buf += w;
      }
    }
    if (buf) out.append(buf);
    span.dataset.tec = '1';
    span.replaceChildren(out);
  }

  function sweep(node) {
    if (node.nodeType !== 1) return;
    if (node.matches && node.matches(FRAGMENT)) processFragment(node);
    node.querySelectorAll && node.querySelectorAll(FRAGMENT).forEach(processFragment);
  }

  function observe() {
    new MutationObserver((muts) => {
      if (!ready) return;
      for (const mu of muts) mu.addedNodes.forEach(sweep);
    }).observe(document.body, { childList: true, subtree: true });
  }

  // ---- Avisos de "chat solo para seguidores / suscriptores" ----
  // Twitch no les da una clase estable, así que se detectan por su texto en cualquier
  // parte del chat EXCEPTO la lista de mensajes (para no tocar mensajes de usuarios).
  const LIST_SEL = '.chat-list--default, .chat-list--other';
  const STOP_SEL = '.chat-input, .chat-room__content, .chat-room, .stream-chat, .chat-shell, #root';
  const RESTRICT_RE = new RegExp(
    [
      '(solo|sólo|only|exclusiv\\w*)[^.\\n]{0,40}(seguidores|suscriptores|followers|subscribers)',
      '(seguidores|suscriptores|followers|subscribers)[- ]?(only|únicamente|solamente)',
      '(seguidores|suscriptores)[^.\\n]{0,25}(solo|sólo)',
      '(sigue|follow|suscr[ií]bete|subscribe)[^.\\n]{0,60}(chatear|chat|hablar|enviar mensajes|send messages)'
    ].join('|'),
    'i'
  );
  const norm = (s) => s.replace(/\s+/g, ' ').trim();

  function hideNotice(el) {
    // Sube mientras el padre contenga exactamente el mismo texto (envoltorios sin más contenido).
    let top = el;
    const txt = norm(el.textContent);
    while (
      top.parentElement &&
      top.parentElement !== document.body &&
      !top.parentElement.matches(STOP_SEL) &&
      norm(top.parentElement.textContent) === txt
    ) {
      top = top.parentElement;
    }
    if (top === document.body || top === document.documentElement || top.matches(STOP_SEL)) return;
    top.classList.add('tec-hidden-notice');
    console.log('[TEC] aviso oculto:', txt.slice(0, 80), '|', top.className.toString().slice(0, 80));
  }

  function scanNotices(node) {
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || !el.closest) return;

    // Dentro de la lista solo se tocan las líneas de estado del sistema.
    if (el.closest(LIST_SEL)) {
      const st = el.closest('.chat-line__status');
      if (st && RESTRICT_RE.test(st.textContent)) st.classList.add('tec-hidden-notice');
      return;
    }
    if (el.closest('.tec-hidden-notice')) return;

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => (n.matches(LIST_SEL) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    const found = [];
    for (let n = el; n; n = walker.nextNode()) {
      if (n.classList.contains('tec-hidden-notice') || n.tagName === 'SCRIPT' || n.tagName === 'STYLE') continue;
      const t = n.textContent;
      if (t.length > 300 || !RESTRICT_RE.test(t)) continue;
      // Solo el elemento más profundo que contiene el texto completo del aviso.
      if ([...n.children].some((c) => RESTRICT_RE.test(c.textContent))) continue;
      found.push(n);
    }
    found.forEach(hideNotice);
  }

  function observeNotices() {
    let pending = new Set();
    let timer = null;
    const flush = () => {
      timer = null;
      const nodes = pending;
      pending = new Set();
      nodes.forEach((n) => { if (n.isConnected || (n.parentElement && n.parentElement.isConnected)) scanNotices(n); });
    };
    new MutationObserver((muts) => {
      for (const mu of muts) {
        pending.add(mu.target);
        mu.addedNodes.forEach((n) => pending.add(n));
      }
      if (!timer) timer = setTimeout(flush, 100);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    pending.add(document.body);
    timer = setTimeout(flush, 100);
  }

  // ---- Botón inferior para mostrar/ocultar el área de escritura ----
  const CHEVRON =
    '<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5-5 5 5"/></svg>';

  function buildInputToggle() {
    if (document.getElementById('tec-input-toggle')) return;
    const btn = document.createElement('button');
    btn.id = 'tec-input-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = CHEVRON + '<span>Escribir</span>';
    const label = btn.querySelector('span');

    btn.addEventListener('click', () => {
      const collapsed = document.documentElement.classList.toggle('tec-input-collapsed');
      btn.setAttribute('aria-expanded', String(!collapsed));
      btn.classList.toggle('tec-open', !collapsed);
      label.textContent = collapsed ? 'Escribir' : 'Ocultar';
      if (!collapsed) {
        setTimeout(() => {
          const ta = document.querySelector('[data-a-target="chat-input"]');
          if (ta) ta.focus();
        }, 60);
      }
    });
    document.body.appendChild(btn);
  }

  const start = () => { buildInputToggle(); observe(); observeNotices(); loadEmotes(); };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
