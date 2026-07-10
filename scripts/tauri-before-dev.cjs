const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const DEV_PORT = Number.parseInt(process.env.CROSSUSAGE_VITE_PORT ?? "1420", 10);

/** `ss -tlnp` lines contain `users:(("node",pid=20626,fd=29))` — not the `511` backlog column. */
function linuxPidsFromSsOutput(text) {
  const out = new Set();
  const re = /pid=(\d+)/g;
  let m;
  while ((m = re.exec(text)) !== null) out.add(m[1]);
  return [...out];
}

function printPortBusyHelp(port, suggestedPids = []) {
  console.error(`\nPort ${port} is already in use (leftover Vite or tauri dev?). Free it, then retry.\n`);
  if (process.platform === "win32") {
    console.error(`  netstat -ano | findstr :${port}`);
    console.error(`  taskkill /PID <pid> /F\n`);
    return;
  }
  if (suggestedPids.length > 0) {
    console.error(`  kill ${suggestedPids.join(" ")}`);
    console.error(`  # still stuck:  kill -9 ${suggestedPids.join(" ")}\n`);
  }
  console.error(`  # Reading ss: the number like 511 is the accept backlog, not a PID.`);
  console.error(`  # Use the pid=… value inside users:((…)) on the same line.`);
  console.error(`  ss -tlnpH 'sport = :${port}'`);
  console.error(
    `  # lsof often misses [::1]-only listeners; prefer ss + kill <pid> on Linux.\n`,
  );
}

/**
 * Vite uses `strictPort: true` and must match `tauri.conf.json` → `build.devUrl`.
 * If something else is listening, fail early with a fix hint (zombie `tauri dev` / `vite`).
 */
function exitIfDevListenPortBusy(port) {
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    console.error(`Invalid CROSSUSAGE_VITE_PORT: ${process.env.CROSSUSAGE_VITE_PORT ?? ""}`);
    process.exit(1);
  }

  if (process.platform === "linux") {
    const r = spawnSync("ss", ["-tlnpH", `sport = :${port}`], { encoding: "utf8" });
    if (!r.error && r.status === 0) {
      if (r.stdout.trim()) {
        printPortBusyHelp(port, linuxPidsFromSsOutput(r.stdout));
        process.exit(1);
      }
      return;
    }
  }

  if (process.platform === "darwin") {
    const r = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    if (!r.error && r.status === 0 && r.stdout.trim()) {
      printPortBusyHelp(port);
      process.exit(1);
    }
    if (!r.error && r.status === 0) return;
  }

  if (process.platform === "win32") {
    const r = spawnSync("cmd", ["/c", `netstat -ano | findstr LISTENING | findstr :${port}`], {
      encoding: "utf8",
    });
    if (r.stdout && r.stdout.includes("LISTENING")) {
      printPortBusyHelp(port);
      process.exit(1);
    }
    return;
  }

  // Fallback: try binding loopback on IPv4 and IPv6 (covers [::1]-only listeners missed by 127.0.0.1-only checks).
  const probe = `
    const net = require("net");
    function tryListen(host, cb) {
      const s = net.createServer();
      s.once("error", (e) => cb(e.code === "EADDRINUSE" ? "inuse" : "skip"));
      s.listen(${port}, host, () => s.close(() => cb("ok")));
    }
    tryListen("127.0.0.1", (a) => {
      if (a === "inuse") process.exit(2);
      if (a !== "ok") process.exit(1);
      tryListen("::1", (b) => {
        if (b === "inuse") process.exit(2);
        process.exit(0);
      });
    });
  `;
  const r = spawnSync(process.execPath, ["-e", probe], { encoding: "utf8" });
  if (r.status === 0) return;
  if (r.status === 2) {
    let pids = [];
    if (process.platform === "linux") {
      const ss = spawnSync("ss", ["-tlnpH", `sport = :${port}`], { encoding: "utf8" });
      if (!ss.error && ss.stdout) pids = linuxPidsFromSsOutput(ss.stdout);
    }
    printPortBusyHelp(port, pids);
    process.exit(1);
  }
  process.exit(r.status === null ? 1 : r.status);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
    shell: process.platform === "win32",
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status === null ? 1 : result.status);
  }
}

run("bun", ["copy-bundled.cjs"]);

exitIfDevListenPortBusy(DEV_PORT);

run("bun", ["x", "vite", "--host", "127.0.0.1", "--port", String(DEV_PORT), "--strictPort"]);
