import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

assert.match(html, /Underlow/);
assert.match(html, /src\/app\.js/);

const playgroundMarkers = [
  "lesson-select",
  "score-value",
  "solved-value",
  "mission-board",
  "mission-feedback",
  "journey-panel",
  "coach-title",
  "coach-copy",
  "mode-label",
  "asm-mode",
  "c-mode",
  "code-editor",
  "assembly-preview",
  "message-log",
  "status-pill",
  "run-button",
  "step-button",
  "reset-button",
  "pixel-display",
  "memory-grid",
  "learn-tab",
  "c-playground-tab",
  "asm-playground-tab",
  "c-playground-editor",
  "c-compile-button",
  "c-generated-assembly",
  "c-diagnostics",
  "asm-playground-editor",
  "asm-playground-run",
  "asm-playground-step",
  "asm-playground-registers",
];

for (const marker of playgroundMarkers) {
  assert.match(html, new RegExp(`id="${marker}"|class="${marker}`), `${marker} should be present for playground smoke tests`);
}

for (const marker of playgroundMarkers.filter((marker) => marker !== "journey-panel")) {
  assert.match(app, new RegExp(`#${marker}`), `${marker} should be wired in app selectors`);
}

assert.match(app, /from "\.\/engine\.js"/);
assert.match(app, /from "\.\/missions\.js"/);
assert.match(app, /compileTinyC/);
assert.match(app, /fetch\("\/api\/compile\/c"/);
assert.match(app, /JSON\.stringify\(\{ code: source \}\)/);
assert.match(app, /normalizeDiagnostics/);
assert.match(app, /compileCPlayground/);
assert.match(app, /compileAsmPlayground/);
assert.match(app, /stepMachine\(asmPlayground\.state, asmPlayground\.program\)/);
assert.match(app, /switchView/);
assert.match(app, /compileErrors/);
assert.match(app, /if \(compileErrors\.length\) return;/);
assert.match(app, /RUN_STEP_LIMIT/);
assert.match(app, /doRunStep/);
assert.match(app, /const solvedMissionIds = new Set\(\);/);
assert.match(app, /solvedMissionIds\.has\(mission\.id\)/);
assert.match(app, /reduce\(\(sum, mission\) => sum \+ mission\.points, 0\)/);
assert.match(app, /Objective complete\. \+\$\{activeMission\(\)\.points\} points\./);
assert.match(app, /renderMissionBoard/);
assert.match(app, /renderMissionFeedback/);
assert.match(app, /renderCoach/);
assert.match(app, /showNextHint/);
assert.match(css, /\.lab-grid/);
assert.match(css, /\.app-tabs/);
assert.match(css, /\.app-view\[data-active="false"\]/);
assert.match(css, /\.playground-grid/);
assert.match(css, /\.mode-toggle/);
assert.match(css, /\.mission-card/);
assert.match(css, /\.mission-feedback/);
assert.match(css, /\.journey-panel/);
assert.match(css, /\.coach-panel/);

console.log("ui smoke checks passed");
