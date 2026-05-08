const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const tauriCli = path.join(root, "node_modules", ".bin", "tauri");
const env = { ...process.env };
if (!env.RUST_LOG) {
  env.RUST_LOG = "info,ignore=warn,globset=warn,tauri_cli=warn";
}

const child = spawn(tauriCli, ["dev"], {
  cwd: root,
  // Keep logs visible, but do not let the Tauri CLI/app read from the terminal.
  // On Unix, detach the Tauri subtree into a new session so no child can be
  // stopped by terminal job-control SIGTTIN if it accidentally opens the tty.
  stdio: ["ignore", "inherit", "inherit"],
  env,
  shell: process.platform === "win32",
  detached: process.platform !== "win32",
});

function stopChild(signal) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if (error.code !== "ESRCH") {
      console.error(error);
    }
  }
}

process.on("SIGINT", () => {
  stopChild("SIGINT");
});
process.on("SIGTERM", () => {
  stopChild("SIGTERM");
});
process.on("exit", () => {
  stopChild("SIGTERM");
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code === null ? 1 : code);
});
