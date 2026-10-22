/* FUSEBOX shared theme runtime. Inlined (classic, synchronous) into <head> by
 * scripts/theme/vite-plugin-fusebox-theme.ts so the theme is applied before first paint.
 * Contract shared by every app:
 *   localStorage["fusebox.theme"] = "light" | "dark"   (absent -> OS preference)
 *   <html class="dark" data-theme="dark" style="color-scheme: dark">
 *   window event "fusebox-theme" (detail: theme) after every change, incl. other tabs (storage event)
 * localStorage may be denied (privacy mode, sandboxed iframes): every access is guarded and the
 * choice is then kept in memory for this page only. No dependencies. */
(function () {
  var KEY = "fusebox.theme";
  var EVT = "fusebox-theme";
  var root = document.documentElement;
  if (window.FuseboxTheme) return;

  function valid(v) { return v === "dark" || v === "light" ? v : null; }
  function stored() { try { return valid(window.localStorage.getItem(KEY)); } catch (e) { return null; } }
  var mq = null;
  try { mq = window.matchMedia("(prefers-color-scheme: dark)"); } catch (e) { mq = null; }
  function system() { return mq && mq.matches ? "dark" : "light"; }
  var memory = stored();

  function current() { return root.classList.contains("dark") ? "dark" : "light"; }
  function apply(t) {
    var dark = t === "dark";
    root.classList.toggle("dark", dark);
    root.setAttribute("data-theme", t);
    root.style.colorScheme = t;
    try { window.dispatchEvent(new CustomEvent(EVT, { detail: t })); } catch (e) { /* very old engines */ }
  }
  function set(t) {
    t = valid(t) || "light";
    memory = t;
    try { window.localStorage.setItem(KEY, t); } catch (e) { /* denied: keep in memory */ }
    apply(t);
  }

  apply(memory || system());

  window.addEventListener("storage", function (e) {
    if (e.key !== KEY && e.key !== null) return; // null = storage cleared
    memory = valid(e.newValue);
    apply(memory || system());
  });
  if (mq) {
    var onSys = function () { if (!memory) apply(system()); };
    if (mq.addEventListener) mq.addEventListener("change", onSys); else if (mq.addListener) mq.addListener(onSys);
  }

  var SUN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';

  /* Floating toggle for apps that do not render their own. Lives outside #root so React never owns it. */
  function mountToggle() {
    function mount() {
      if (document.getElementById("fusebox-theme-toggle")) return;
      var b = document.createElement("button");
      b.type = "button";
      b.id = "fusebox-theme-toggle";
      b.className = "fbx-theme-toggle";
      b.setAttribute("data-testid", "button-theme-toggle");
      b.setAttribute("aria-label", "Dark theme");
      function sync() {
        var dark = current() === "dark";
        b.setAttribute("aria-pressed", dark ? "true" : "false");
        b.title = dark ? "Switch to light theme" : "Switch to dark theme";
        b.innerHTML = (dark ? SUN : MOON) + '<span class="fbx-theme-toggle__label">' + (dark ? "Light" : "Dark") + "</span>";
      }
      b.addEventListener("click", function () { set(current() === "dark" ? "light" : "dark"); });
      window.addEventListener(EVT, sync);
      sync();
      document.body.appendChild(b);
    }
    if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
  }

  window.FuseboxTheme = {
    key: KEY,
    event: EVT,
    get: current,
    set: set,
    toggle: function () { set(current() === "dark" ? "light" : "dark"); },
    mountToggle: mountToggle
  };
})();
