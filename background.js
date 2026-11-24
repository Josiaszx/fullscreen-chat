// Service worker: hace las peticiones a las APIs de emotes (los content scripts
// están sujetos al CORS de la página; el service worker con host_permissions no).
const ALLOWED_HOSTS = new Set(['api.ivr.fi', '7tv.io', 'api.betterttv.net', 'api.frankerfacez.com']);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'tec-fetch') return;

  let url;
  try {
    url = new URL(msg.url);
  } catch (_) {
    sendResponse({ ok: false, error: 'url invalida' });
    return;
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
    sendResponse({ ok: false, error: 'host no permitido' });
    return;
  }

  fetch(url.href)
    .then((r) => {
      // 404 = el canal no tiene emotes en ese servicio (normal). Se devuelve "sin datos".
      if (r.status === 404) return null;
      return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status));
    })
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));

  return true; // respuesta asíncrona
});
