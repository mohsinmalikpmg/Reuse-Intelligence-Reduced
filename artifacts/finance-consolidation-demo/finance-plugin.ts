import { spawn } from "node:child_process";
import path from "node:path";
import type { Plugin, Connect } from "vite";

export function financePlugin(base: string): Plugin {
  let active = 0;
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    if (req.url?.split("?")[0] !== `${base}api/run` && req.url?.split("?")[0] !== "/api/run") return next();
    let responded = false;
    const send = (code: number, data: unknown) => {
      if (responded || res.destroyed || res.writableEnded || res.headersSent) return;
      responded = true;
      res.statusCode = code;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(data));
    };
    if (req.method !== "POST") return send(405, { error: "Use POST." });
    if (!req.headers["content-type"]?.startsWith("application/json")) return send(415, { error: "JSON is required." });
    if (active >= 4) return send(503, { error: "Calculations are busy. Please retry." });
    active++;
    let released = false;
    const release = () => { if (!released) { active--; released = true; } };
    let body = "", size = 0, rejected = false;
    req.setTimeout(5000, () => { release(); req.destroy(); });
    req.on("error", release);
    req.on("aborted", release);
    req.on("data", (chunk: Buffer) => {
      if (rejected || responded) return;
      size += chunk.length;
      if (size > 4096) {
        rejected = true;
        body = "";
        release();
        send(413, { error: "Request too large." });
      } else body += chunk.toString();
    });
    req.on("end", () => {
      if (rejected) return;
      // Deliberately do not inherit workspace secrets or Python import environment.
      const child = spawn("python3", ["-B", path.resolve(import.meta.dirname, "worker.py")], {
        cwd: import.meta.dirname, env: { PATH: process.env.PATH, PYTHONNOUSERSITE: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "", failed = false;
      const timer = setTimeout(() => { failed = true; child.kill("SIGKILL"); }, 15000);
      res.on("close", () => { if (!res.writableEnded) child.kill("SIGKILL"); });
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.length > 100000) { failed = true; child.kill("SIGKILL"); }
      });
      child.stderr.on("data", () => { /* never expose paths or process diagnostics to callers */ });
      child.stdin.on("error", () => {});
      child.on("error", () => { clearTimeout(timer); release(); send(500, { error: "Python calculation service could not start." }); });
      child.on("close", (code) => {
        clearTimeout(timer); release();
        if (failed || (code !== 0 && code !== 2)) return send(500, { error: "Calculation failed. Please retry." });
        try { send(code === 2 ? 400 : 200, JSON.parse(output)); }
        catch { send(500, { error: "Calculation returned an invalid response." }); }
      });
      child.stdin.end(body);
    });
  };
  return { name: "isolated-finance-calculation",
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); } };
}
