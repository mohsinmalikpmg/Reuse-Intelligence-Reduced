// Dependency-free browser smoke check. Start Chromium with --remote-debugging-port=9222.
// Node 20: node --experimental-websocket scripts/theme/check-theme.mjs
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const origin = process.env.THEME_TEST_ORIGIN ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;
async function page() {
  const target = await (await fetch("http://localhost:9222/json/new?about:blank", { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const entry = pending.get(message.id);
    if (entry) {
      pending.delete(message.id);
      message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
    }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    pending.set(key, { resolve, reject });
    ws.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const until = async (expression) => {
    for (let n = 0; n < 100; n++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out: ${expression}`);
  };
  const navigate = async path => {
    await call("Page.navigate", { url: origin + path });
    await until(`location.href === ${JSON.stringify(origin + path)} && document.readyState === 'complete' && !!document.querySelector('[data-testid="button-theme-toggle"]')`);
  };
  return { call, evaluate, until, navigate, close: () => ws.close() };
}

const first = await page();
const second = await page();
try {
  await first.navigate("/library?as=seeker");
  await first.evaluate("window.FuseboxTheme.set('light')");
  await first.evaluate(`document.querySelector('[data-testid="button-theme-toggle"]').click()`);
  assert.equal(await first.evaluate("localStorage.getItem('fusebox.theme')"), "dark");
  for (const path of ["/", "/workbench/case_demo?as=seeker", "/fusebox-intake/", "/invoice-consolidation/", "/finance-demo/", "/invoice-finder/", "/approval-desk/", "/spend-tracker/"]) {
    await first.navigate(path);
    const state = await first.evaluate(`({
      dark:document.documentElement.classList.contains('dark'),
      scheme:getComputedStyle(document.documentElement).colorScheme,
      background:getComputedStyle(document.body).backgroundColor,
      toggle:document.querySelector('[data-testid="button-theme-toggle"]').getAttribute('aria-pressed')
    })`);
    assert.equal(state.dark, true, path);
    assert.equal(state.scheme, "dark", path);
    assert.equal(state.toggle, "true", path);
    console.log(path, state);
  }
  await first.call("Page.reload");
  await first.until("document.readyState === 'complete' && !!document.querySelector('[data-testid=\"button-theme-toggle\"]')");
  assert.equal(await first.evaluate("document.documentElement.classList.contains('dark')"), true);
  await second.navigate("/library?as=seeker");
  const screenshot = await second.call("Page.captureScreenshot", { format: "png" });
  await writeFile("/tmp/fusebox-dark-check.png", Buffer.from(screenshot.data, "base64"));
  await first.evaluate(`document.querySelector('[data-testid="button-theme-toggle"]').click()`);
  await second.until("!document.documentElement.classList.contains('dark')");
  assert.equal(await second.evaluate("localStorage.getItem('fusebox.theme')"), "light");
  console.log("PASS: cross-app navigation, reload, accessible toggles, cross-tab sync, light restoration");
} finally {
  first.close();
  second.close();
}
