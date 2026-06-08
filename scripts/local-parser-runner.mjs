#!/usr/bin/env node
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.AGROMAT_LOCAL_RUNNER_PORT || "8765");
const ALLOWED_ORIGIN_RE = new RegExp(process.env.AGROMAT_LOCAL_RUNNER_ORIGIN_RE || "^(https?://(localhost|127\\.0\\.0\\.1)(:\\d+)?|https?://91\\.239\\.233\\.125(:\\d+)?)$");

const jobs = new Map();

function json(res, status, payload, origin = "") {
  if (origin && ALLOWED_ORIGIN_RE.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
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

function makeCommand(adapter) {
  if (adapter === "santechshara") {
    return {
      cwd: ROOT,
      title: "Agromat Santechshara local parser",
      command: `SANTECHSHARA_HEADLESS=false ${shellQuote(process.execPath)} ${shellQuote(path.join(ROOT, "scripts", "santechshara-worker.mjs"))}`,
      windowsCommand: `set SANTECHSHARA_HEADLESS=false && ${winQuote(process.execPath)} ${winQuote(path.join(ROOT, "scripts", "santechshara-worker.mjs"))}`,
    };
  }

  if (adapter === "vannaja") {
    const repo = parserRepoPath();
    const script = path.join(repo, "scraper", process.platform === "win32" ? "refresh_vannaja.bat" : "refresh_vannaja.sh");
    const fallbackPy = path.join(repo, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    const fallbackScript = path.join(repo, "scraper", "run_vannaja_scrape.py");
    return {
      cwd: repo,
      title: "Agromat Vannaja local parser",
      command: `[ -x ${shellQuote(script)} ] && ${shellQuote(script)} || VANNAJA_FIRST_WAIT_SECONDS=12 VANNAJA_WAIT_SECONDS=6 ${shellQuote(fallbackPy)} ${shellQuote(fallbackScript)}`,
      windowsCommand: `if exist ${winQuote(script)} (${winQuote(script)}) else (set VANNAJA_FIRST_WAIT_SECONDS=12 && set VANNAJA_WAIT_SECONDS=6 && ${winQuote(fallbackPy)} ${winQuote(fallbackScript)})`,
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
  const spec = makeCommand(adapter);
  if (!spec) return { ok: false, error: "action_not_allowed" };

  const jobId = `local-${adapter}-${Date.now().toString(36)}`;
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
  return jobs.get(jobId);
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  if (req.method === "OPTIONS") return json(res, 204, {}, origin);

  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname === "/health") {
    return json(res, 200, { ok: true, name: "agromat-local-parser-runner", port: PORT, platform: os.platform() }, origin);
  }

  const runMatch = url.pathname.match(/^\/run\/(santechshara|vannaja)$/);
  if (req.method === "POST" && runMatch) {
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
