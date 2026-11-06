// FormForge embed loader v1 — served from GET /api/public/embed/embed.js.
//
// Issue #22: three embed modes — `inline` (standard div), `popup` and `side-tab`
// — driven entirely by data attributes, speaking the child<->parent postMessage
// protocol from /embed/:docId (spec §10.2):
//   child -> parent:  ff:ready, ff:height { value }, ff:complete { submissionToken }
//   parent -> child:  ff:request-height
// The loader is plain, dependency-free JavaScript (kept ES2017-compatible) that
// hosts paste next to their markup. It is stored as a string so the route can
// serve it with immutable-ish caching and CORS headers without a bundler step.
//
// Security posture:
//  - the child posts with targetOrigin "*" (public plane, no secrets in these
//    messages — see /embed/[docId]/protocol.ts);
//  - this loader is the strict side: it only accepts messages whose
//    `event.origin` matches the app origin it was loaded from, and whose
//    `event.source` is one of its own iframes;
//  - all parent -> child posts use the same explicit origin as targetOrigin.
//
// INTEGRATION-DEBT: an integrator may add a next.config rewrite
// `/embed.v1.js -> /api/public/embed/embed.js` so the snippet URL matches the
// issue title verbatim; the route below stays the single source of truth.
export const EMBED_LOADER_VERSION = "v1";

export const EMBED_LOADER_V1 = String.raw`(function () {
  "use strict";

  if (window.__formForgeEmbedLoaded) return;
  window.__formForgeEmbedLoaded = true;

  var VERSION = "v1";
  var MODE_ALIASES = { inline: "inline", div: "inline", "full-page": "inline", popup: "popup", "side-tab": "side-tab" };
  var INITIAL_INLINE_HEIGHT = 480;
  var MAX_HEIGHT = 30000;
  var PANEL_WIDTH = "min(420px, 90vw)";
  var Z = "2147483000";

  var records = [];
  var byWindow = typeof WeakMap === "function" ? new WeakMap() : null;
  var appOrigin = "";

  function attr(node, name) {
    try { return node.getAttribute(name); } catch (err) { return null; }
  }

  function el(tag, css, attributes) {
    var node = document.createElement(tag);
    if (css) node.style.cssText = css;
    if (attributes) {
      for (var key in attributes) {
        if (Object.prototype.hasOwnProperty.call(attributes, key)) node.setAttribute(key, attributes[key]);
      }
    }
    return node;
  }

  function normalizeMode(raw) {
    var key = String(raw || "").toLowerCase();
    return MODE_ALIASES[key] || "inline";
  }

  function currentScript() {
    if (document.currentScript) return document.currentScript;
    var all = document.getElementsByTagName("script");
    return all[all.length - 1];
  }

  function detectOrigin(scriptEl) {
    var explicit = attr(scriptEl, "data-formforge-origin");
    if (explicit) return String(explicit).replace(/\/+$/, "");
    try { return new URL(scriptEl.src, window.location.href).origin; }
    catch (err) { return window.location.origin; }
  }

  function cssEscape(value) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(value);
    return String(value).replace(/([^a-zA-Z0-9_\u00A0-\uFFFF-])/g, "\\$1");
  }

  function frameSrc(rec) {
    return appOrigin + "/embed/" + encodeURIComponent(rec.docId) + "?mode=" + rec.mode + "&v=" + VERSION;
  }

  function buildIframe(rec) {
    var frame = el(
      "iframe",
      "display:block;width:100%;height:" + (rec.mode === "inline" ? INITIAL_INLINE_HEIGHT + "px" : "100%") + ";border:0;background:transparent;",
      { title: rec.label, src: frameSrc(rec), loading: "lazy", allowtransparency: "true" }
    );
    return frame;
  }

  function watch(rec) {
    if (byWindow && rec.iframe && rec.iframe.contentWindow) byWindow.set(rec.iframe.contentWindow, rec);
  }

  function baseRecord(container, docId, mode, label) {
    return { container: container, docId: docId, mode: mode, label: label, ready: false, isOpen: null, open: null, close: null, lastFocus: null, iframe: null, body: null };
  }

  function dispatch(rec, type, detail) {
    try {
      rec.container.dispatchEvent(new CustomEvent(type, { bubbles: true, detail: detail }));
      window.dispatchEvent(new CustomEvent(type, { detail: detail }));
    } catch (err) { /* older browsers without CustomEvent — non-fatal */ }
  }

  function ping(rec) {
    try { rec.iframe.contentWindow.postMessage({ type: "ff:request-height" }, appOrigin); } catch (err) { /* frame gone */ }
  }

  function capFor(rec) {
    if (rec.mode === "inline" || !rec.body) return null;
    var height = rec.body.clientHeight;
    if (!height || height < 120) return null; // hidden overlay: let the iframe size itself until shown
    return height;
  }

  function onMessage(event) {
    if (appOrigin && event.origin !== appOrigin) return;
    if (!byWindow) return;
    var rec = byWindow.get(event.source);
    if (!rec) return;
    var data = event.data;
    if (!data || typeof data.type !== "string") return;

    if (data.type === "ff:ready") {
      rec.ready = true;
      dispatch(rec, "formforge:ready", { docId: rec.docId, mode: rec.mode });
      ping(rec);
      return;
    }
    if (data.type === "ff:height") {
      var value = Math.floor(Number(data.value));
      if (!isFinite(value) || value <= 0 || value > MAX_HEIGHT) return;
      var cap = capFor(rec);
      rec.iframe.style.height = (cap !== null && cap < value ? cap : value) + "px";
      return;
    }
    if (data.type === "ff:complete") {
      dispatch(rec, "formforge:complete", { docId: rec.docId, mode: rec.mode, submissionToken: String(data.submissionToken || "") });
    }
  }

  var resizeTimer = 0;
  function onResize() {
    if (resizeTimer) return;
    resizeTimer = setTimeout(function () {
      resizeTimer = 0;
      for (var i = 0; i < records.length; i++) {
        if (records[i].ready) ping(records[i]);
      }
    }, 150);
  }

  function onKeyDown(event) {
    if (!event || event.key !== "Escape") return;
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      if (typeof rec.isOpen === "function" && rec.isOpen()) rec.close();
    }
  }

  // --- mode: inline (standard div) ---------------------------------------
  function initInline(rec) {
    rec.iframe = buildIframe(rec);
    rec.container.appendChild(rec.iframe);
    watch(rec);
  }

  // --- shared chrome for popup / side-tab ---------------------------------
  function chromeHeader(rec, onClose) {
    var header = el("div", "display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 12px 12px 20px;border-bottom:1px solid #e2e8f0;flex:0 0 auto;");
    var title = el("div", "font:600 14px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;");
    title.textContent = rec.label;
    var close = el("button", "appearance:none;border:0;cursor:pointer;border-radius:8px;background:#f1f5f9;color:#0f172a;font:600 12px/1 system-ui,-apple-system,'Segoe UI',sans-serif;padding:8px 10px;flex:0 0 auto;", { type: "button", "aria-label": "Close form" });
    close.textContent = "Close";
    close.addEventListener("click", onClose);
    header.appendChild(title);
    header.appendChild(close);
    return { header: header, close: close };
  }

  // --- mode: popup ---------------------------------------------------------
  function initPopup(rec) {
    var overlay = el("div", "position:fixed;inset:0;z-index:" + Z + ";display:none;align-items:center;justify-content:center;padding:24px;background:rgba(15,23,42,0.55);", { role: "dialog", "aria-modal": "true", "aria-label": rec.label });
    var card = el("div", "display:flex;flex-direction:column;width:min(560px, 92vw);height:min(720px, 86vh);background:#ffffff;border-radius:16px;box-shadow:0 24px 64px rgba(15,23,42,0.35);overflow:hidden;");
    var chrome = chromeHeader(rec, function () { rec.close(); });
    var body = el("div", "flex:1 1 auto;min-height:0;");
    rec.iframe = buildIframe(rec);
    rec.body = body;
    body.appendChild(rec.iframe);
    card.appendChild(chrome.header);
    card.appendChild(body);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    watch(rec);
    overlay.addEventListener("mousedown", function (event) { if (event.target === overlay) rec.close(); });

    rec.isOpen = function () { return overlay.style.display === "flex"; };
    rec.open = function () {
      if (rec.isOpen()) return;
      rec.lastFocus = document.activeElement;
      overlay.style.display = "flex";
      trigger.setAttribute("aria-expanded", "true");
      try { chrome.close.focus(); } catch (err) { /* ignore */ }
      if (rec.ready) ping(rec);
    };
    rec.close = function () {
      if (!rec.isOpen()) return;
      overlay.style.display = "none";
      trigger.setAttribute("aria-expanded", "false");
      if (rec.lastFocus && typeof rec.lastFocus.focus === "function") {
        try { rec.lastFocus.focus(); } catch (err) { /* ignore */ }
      }
    };

    var trigger = el("button", "appearance:none;display:inline-flex;align-items:center;gap:8px;border:0;cursor:pointer;background:#0f172a;color:#ffffff;font:600 14px/1 system-ui,-apple-system,'Segoe UI',sans-serif;padding:12px 18px;border-radius:999px;", { type: "button", "aria-haspopup": "dialog", "aria-expanded": "false" });
    trigger.textContent = rec.label;
    trigger.addEventListener("click", function () {
      if (rec.isOpen()) rec.close(); else rec.open();
    });
    rec.container.appendChild(trigger);
  }

  // --- mode: side-tab --------------------------------------------------------
  function initSideTab(rec) {
    var dock = el("div", "position:fixed;top:50%;right:0;z-index:" + Z + ";display:flex;align-items:stretch;transform:translateY(-50%) translateX(" + PANEL_WIDTH + ");transition:transform 0.25s ease;");
    var panel = el("div", "display:flex;flex-direction:column;width:" + PANEL_WIDTH + ";height:min(640px, 84vh);background:#ffffff;box-shadow:-12px 0 40px rgba(15,23,42,0.18);overflow:hidden;border-radius:12px 0 0 12px;margin-right:-1px;");
    var chrome = chromeHeader(rec, function () { rec.close(); });
    var body = el("div", "flex:1 1 auto;min-height:0;");
    rec.iframe = buildIframe(rec);
    rec.body = body;
    body.appendChild(rec.iframe);
    panel.appendChild(chrome.header);
    panel.appendChild(body);
    dock.appendChild(panel);

    var tab = el("button", "appearance:none;border:0;cursor:pointer;background:#0f172a;color:#ffffff;font:600 13px/1 system-ui,-apple-system,'Segoe UI',sans-serif;padding:14px 10px;border-radius:8px 0 0 8px;flex:0 0 auto;align-self:center;", { type: "button", "aria-expanded": "false" });
    tab.textContent = rec.label;
    dock.appendChild(tab);
    document.body.appendChild(dock);
    watch(rec);

    rec.isOpen = function () { return dock.getAttribute("data-ff-open") === "1"; };
    rec.open = function () {
      if (rec.isOpen()) return;
      rec.lastFocus = document.activeElement;
      dock.setAttribute("data-ff-open", "1");
      dock.style.transform = "translateY(-50%)";
      tab.setAttribute("aria-expanded", "true");
      try { chrome.close.focus(); } catch (err) { /* ignore */ }
      if (rec.ready) ping(rec);
    };
    rec.close = function () {
      if (!rec.isOpen()) return;
      dock.setAttribute("data-ff-open", "0");
      dock.style.transform = "translateY(-50%) translateX(" + PANEL_WIDTH + ")";
      tab.setAttribute("aria-expanded", "false");
      if (rec.lastFocus && typeof rec.lastFocus.focus === "function") {
        try { rec.lastFocus.focus(); } catch (err) { /* ignore */ }
      }
    };
    tab.addEventListener("click", function () {
      if (rec.isOpen()) rec.close(); else rec.open();
    });
  }

  function initOne(container, docId, mode, label) {
    if (!docId) return null;
    var text = label || (mode === "popup" ? "Open form" : mode === "side-tab" ? "Feedback" : "FormForge form");
    var rec = baseRecord(container, String(docId), mode, text);
    if (mode === "popup") initPopup(rec);
    else if (mode === "side-tab") initSideTab(rec);
    else initInline(rec);
    rec.container.setAttribute("data-ff-embed-ready", "1");
    records.push(rec);
    return rec;
  }

  function initAll() {
    var scriptEl = currentScript();
    appOrigin = detectOrigin(scriptEl);
    var scriptMode = normalizeMode(attr(scriptEl, "data-formforge-mode"));

    var divs = document.querySelectorAll("[data-formforge-embed]");
    for (var i = 0; i < divs.length; i++) {
      var div = divs[i];
      if (attr(div, "data-ff-embed-ready")) continue;
      var rawMode = attr(div, "data-formforge-mode");
      initOne(div, attr(div, "data-formforge-embed"), rawMode ? normalizeMode(rawMode) : scriptMode, attr(div, "data-formforge-label"));
    }

    var docFromScript = attr(scriptEl, "data-formforge-doc");
    if (docFromScript) {
      var existing = null;
      try { existing = document.querySelector('[data-formforge-embed="' + cssEscape(docFromScript) + '"]'); } catch (err) { /* bad selector shape */ }
      if (!existing) {
        existing = el("div", "width:100%;");
        existing.setAttribute("data-formforge-embed", docFromScript);
        if (scriptEl.parentNode) scriptEl.parentNode.insertBefore(existing, scriptEl.nextSibling);
        else document.body.appendChild(existing);
      }
      if (!attr(existing, "data-ff-embed-ready")) {
        initOne(existing, docFromScript, scriptMode, attr(scriptEl, "data-formforge-label"));
      }
    }

    if (!records.length) {
      try { window.console.warn("[FormForge] embed loader v" + VERSION + " loaded without a document. Add data-formforge-doc=\u2026 to the script tag, or <div data-formforge-embed=\u2026></div> to the page."); } catch (err) { /* ignore */ }
    }
  }

  window.addEventListener("message", onMessage, false);
  window.addEventListener("resize", onResize, false);
  document.addEventListener("keydown", onKeyDown, false);

  function boot() {
    try { initAll(); } catch (err) {
      try { window.console.error("[FormForge] embed loader failed to initialize", err); } catch (ignored) { /* ignore */ }
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // Public surface (kept intentionally small; see /embed docs).
  window.FormForgeEmbed = {
    version: VERSION,
    records: records,
    scan: function () { try { initAll(); } catch (err) { /* ignore */ } }
  };
})();
`;
