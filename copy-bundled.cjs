const { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } = require("fs")
const { join } = require("path")

const root = __dirname
const exclude = new Set(["mock"])
const srcDir = join(root, "plugins")
const dstDir = join(root, "src-tauri", "resources", "bundled_plugins")

rmSync(dstDir, { recursive: true, force: true })

const plugins = readdirSync(srcDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !exclude.has(d.name))
  .map((d) => d.name)

function buildCursorNightlyPlugin() {
  const nightlyDir = join(srcDir, "cursor-nightly")
  const cursorJs = readFileSync(join(srcDir, "cursor", "plugin.js"), "utf8")
  writeFileSync(
    join(nightlyDir, "plugin.js"),
    `globalThis.__OPENUSAGE_PLUGIN_REGISTRATION_ID__ = "cursor-nightly";\n${cursorJs}`,
  )
}

buildCursorNightlyPlugin()

for (const id of plugins) {
  cpSync(join(srcDir, id), join(dstDir, id), { recursive: true })
}

console.log(`Bundled ${plugins.length} plugins: ${plugins.join(", ")}`)
