#!/usr/bin/env bun
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { makeTrayBarsSvg } from "../src/lib/tray-bars-icon.ts";

const repoRoot = resolve(import.meta.dir, "..");
mkdirSync(resolve(repoRoot, "tmp-debug"), { recursive: true });
const cursorIconSvg = readFileSync(
  resolve(repoRoot, "plugins/cursor/icon.svg"),
  "utf8"
);
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(cursorIconSvg).toString("base64")}`;

for (const size of [22, 30, 60]) {
  for (const ink of ["#000000", "#ffffff"]) {
    const svg = makeTrayBarsSvg({
      sizePx: size,
      style: "provider",
      providerIconUrl: dataUrl,
      foregroundHex: ink,
      gridCells: [{ text: "76%" }],
    });
    const fileName = `inspect-tray-${size}-${ink === "#000000" ? "dark" : "light"}.svg`;
    const outPath = resolve(repoRoot, "tmp-debug", fileName);
    writeFileSync(outPath, svg, "utf8");
    console.log(outPath);
  }
}
