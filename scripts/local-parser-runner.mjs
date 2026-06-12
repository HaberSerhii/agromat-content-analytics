#!/usr/bin/env node
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.AGROMAT_LOCAL_RUNNER_PORT || "8765");
const ALLOWED_ORIGIN_RE = process.env.AGROMAT_LOCAL_RUNNER_ORIGIN_RE
  ? new RegExp(process.env.AGROMAT_LOCAL_RUNNER_ORIGIN_RE)
  : null;

const jobs = new Map();

function json(res, status, payload, origin = "") {
  if (origin && (!ALLOWED_ORIGIN_RE || ALLOWED_ORIGIN_RE.test(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.writeHead(status);
  res.end(`${JSON.stringify(payload)}\n`);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
  });
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function winQuote(s) {
  return `"${String(s).replace(/"/g, '\\"')}"`;
}

function parserRepoPath() {
  const fromEnv = process.env.AGROMAT_PARSER_REPO;
  if (fromEnv) return fromEnv;
  const sibling = path.resolve(ROOT, "..", "Agromat_Parcer");
  return sibling;
}

function makeCommand(adapter, jobId) {
  if (adapter === "santechshara") {
    const envFile = path.join(ROOT, ".env");
    return {
      cwd: ROOT,
      title: "Agromat Santechshara local parser",
      command: `SANTECHSHARA_HEADLESS=false ${shellQuote(process.execPath)} --env-file=${shellQuote(envFile)} ${shellQuote(path.join(ROOT, "scripts", "santechshara-worker.mjs"))} --job-id ${shellQuote(jobId)}`,
      windowsCommand: `set SANTECHSHARA_HEADLESS=false && ${winQuote(process.execPath)} --env-file=${winQuote(envFile)} ${winQuote(path.join(ROOT, "scripts", "santechshara-worker.mjs"))} --job-id ${winQuote(jobId)}`,
    };
  }

  if (adapter === "vannaja") {
    const envFile = path.join(ROOT, ".env");
    return {
      cwd: ROOT,
      title: "Agromat Vannaja local parser",
      command: `${shellQuote(process.execPath)} --env-file=${shellQuote(envFile)} ${shellQuote(path.join(ROOT, "scripts", "vannaja-worker.mjs"))} --job-id ${shellQuote(jobId)}`,
      windowsCommand: `${winQuote(process.execPath)} --env-file=${winQuote(envFile)} ${winQuote(path.join(ROOT, "scripts", "vannaja-worker.mjs"))} --job-id ${winQuote(jobId)}`,
    };
  }

  return null;
}

function terminalCommand({ cwd, title, command, windowsCommand }) {
  if (process.platform === "darwin") {
    const script = [
      `cd ${shellQuote(cwd)}`,
      command,
      "echo ''",
      "echo 'Готово. Можно закрыть окно.'",
    ].join("; ");
    const escaped = script.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return {
      bin: "osascript",
      args: ["-e", `tell application "Terminal" to do script "${escaped}"`, "-e", 'tell application "Terminal" to activate'],
    };
  }

  if (process.platform === "win32") {
    return {
      bin: "cmd.exe",
      args: ["/c", "start", title, "cmd.exe", "/k", `cd /d ${winQuote(cwd)} && ${windowsCommand}`],
    };
  }

  const script = `cd ${shellQuote(cwd)}; ${command}; echo; echo 'Done. Press Enter to close.'; read _`;
  const candidates = [
    { bin: "x-terminal-emulator", args: ["-e", "bash", "-lc", script] },
    { bin: "gnome-terminal", args: ["--", "bash", "-lc", script] },
    { bin: "konsole", args: ["-e", "bash", "-lc", script] },
    { bin: "xfce4-terminal", args: ["-e", `bash -lc ${shellQuote(script)}`] },
  ];
  return candidates[0];
}

function start(adapter) {
  const jobId = `local-${adapter}-${Date.now().toString(36)}`;
  const spec = makeCommand(adapter, jobId);
  if (!spec) return { ok: false, error: "action_not_allowed" };

  console.log(`[${new Date().toISOString()}] Starting ${adapter} parser job ${jobId}`);
  const job = {
    ok: true,
    job_id: jobId,
    action: `prices-${adapter}`,
    status: "starting",
    current: 0,
    total: 0,
    label: `${adapter}: локальний термінал запускається`,
    started_at: Math.floor(Date.now() / 1000),
    finished_at: null,
    error: null,
    result: null,
  };
  jobs.set(jobId, job);

  const term = terminalCommand(spec);
  const child = spawn(term.bin, term.args, { detached: true, stdio: "ignore" });
  child.on("error", (e) => {
    console.error(`[${new Date().toISOString()}] Failed to open terminal for ${adapter} job ${jobId}: ${String(e?.message || e)}`);
    jobs.set(jobId, {
      ...job,
      status: "error",
      finished_at: Math.floor(Date.now() / 1000),
      error: String(e?.message || e),
      label: `${adapter}: не вдалося відкрити термінал`,
    });
  });
  child.unref();

  jobs.set(jobId, {
    ...job,
    status: "running",
    label: `${adapter}: команда відкрита в локальному терміналі`,
  });
  console.log(`[${new Date().toISOString()}] Opened local terminal for ${adapter} parser job ${jobId}`);
  return jobs.get(jobId);
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  if (req.method === "OPTIONS") {
    console.log(`[${new Date().toISOString()}] Received OPTIONS ${req.url || "/"} origin=${origin || "-"}`);
    return json(res, 204, {}, origin);
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname === "/health") {
    return json(res, 200, { ok: true, name: "agromat-local-parser-runner", port: PORT, platform: os.platform() }, origin);
  }

  const runMatch = url.pathname.match(/^\/run\/(santechshara|vannaja)$/);
  if (req.method === "POST" && runMatch) {
    console.log(`[${new Date().toISOString()}] Received ${req.method} ${url.pathname} origin=${origin || "-"}`);
    await readBody(req);
    const result = start(runMatch[1]);
    return json(res, result.ok ? 200 : 400, result, origin);
  }

  const jobMatch = url.pathname.match(/^\/job\/([a-z0-9-]+)$/i);
  if (req.method === "GET" && jobMatch) {
    const job = jobs.get(jobMatch[1]);
    return json(res, job ? 200 : 404, job || { ok: false, error: "not_found" }, origin);
  }

  return json(res, 404, { ok: false, error: "not_found" }, origin);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Agromat local parser runner: http://127.0.0.1:${PORT}`);
  console.log("Allowed actions: /run/santechshara, /run/vannaja");
  console.log(`Agromat Analytics repo: ${ROOT}`);
  console.log(`Agromat parser repo: ${parserRepoPath()}`);
});
