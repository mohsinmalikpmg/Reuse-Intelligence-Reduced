/**
 * Vite plugin: FUSEBOX global light/dark theme.
 *
 * Injects at transformIndexHtml (dev server AND production build):
 *   1. <style id="fusebox-theme-css">  theme-base.css + per-app dark overrides (apps/<app>.generated.css, apps/<app>.css)
 *      plus a pre-paint html background so a dark choice never flashes light while app CSS loads.
 *   2. <script id="fusebox-theme-runtime"> classic inline script (synchronous, before any module) that
 *      reads localStorage "fusebox.theme" and sets html.dark / data-theme / color-scheme.
 *   3. optionally mounts the shared floating, accessible toggle (apps without their own header control).
 *
 * Only node builtins at runtime; `import type` is erased when Vite bundles the config.
 * Used through each artifact's host-theme.vite.config.ts so original vite configs/index.html stay untouched.
 */
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

export interface FuseboxThemeOptions {
  /** Key under scripts/theme/apps/ for per-app dark overrides. */
  app: string;
  /** Mount the shared floating toggle (default true). Set false where the app renders its own control. */
  floatingToggle?: boolean;
  /** Page background painted on <html> in dark mode before app CSS arrives. */
  darkBackground?: string;
  /** Page background painted on <html> in light mode before app CSS arrives. */
  lightBackground?: string;
}

const HERE = path.dirname(new URL(import.meta.url).pathname);

function read(file: string): string {
  try {
    return fs.readFileSync(path.join(HERE, file), "utf8");
  } catch {
    return "";
  }
}

export function fuseboxTheme(opts: FuseboxThemeOptions): Plugin {
  const load = () => {
    const css = [
      read("theme-base.css"),
      read(`apps/${opts.app}.generated.css`),
      read(`apps/${opts.app}.css`),
      `html{background-color:${opts.lightBackground ?? "#f6f7f4"}}html.dark{background-color:${opts.darkBackground ?? "#0b1a21"}}`,
    ].join("\n");
    let js = read("theme-runtime.js");
    if (opts.floatingToggle !== false) js += "\nwindow.FuseboxTheme && window.FuseboxTheme.mountToggle();";
    return { css, js };
  };

  return {
    name: "fusebox-theme",
    configureServer(server) {
      // Edits to the shared theme sources reload dev pages.
      const files = ["theme-base.css", "theme-runtime.js", `apps/${opts.app}.generated.css`, `apps/${opts.app}.css`].map((f) => path.join(HERE, f));
      server.watcher.add(files);
      server.watcher.on("change", (f) => {
        if (files.includes(f)) server.ws.send({ type: "full-reload" });
      });
    },
    transformIndexHtml: {
      order: "pre",
      handler() {
        const { css, js } = load();
        return [
          { tag: "style", attrs: { id: "fusebox-theme-css" }, children: css, injectTo: "head" },
          { tag: "script", attrs: { id: "fusebox-theme-runtime" }, children: js.replace(/<\/script/gi, "<\\/script"), injectTo: "head" },
        ];
      },
    },
  };
}

export default fuseboxTheme;
