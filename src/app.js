import {
  compileTinyC,
  createInitialState,
  parseProgram,
  stepMachine,
  validateLesson,
} from "./engine.js";
import { missions } from "./missions.js";

const els = {
  missionSelect: document.querySelector("#lesson-select"),
  missionTitle: document.querySelector("#lesson-title"),
  missionObjective: document.querySelector("#lesson-objective"),
  missionExplanation: document.querySelector("#lesson-explanation"),
  missionBoard: document.querySelector("#mission-board"),
  boardCount: document.querySelector("#board-count"),
  progressFill: document.querySelector("#progress-fill"),
  missionFeedback: document.querySelector("#mission-feedback"),
  coachTitle: document.querySelector("#coach-title"),
  coachCopy: document.querySelector("#coach-copy"),
  hint: document.querySelector("#hint-button"),
  modeLabel: document.querySelector("#mode-label"),
  score: document.querySelector("#score-value"),
  solved: document.querySelector("#solved-value"),
  asmMode: document.querySelector("#asm-mode"),
  cMode: document.querySelector("#c-mode"),
  editor: document.querySelector("#code-editor"),
  generatedAssembly: document.querySelector("#assembly-preview"),
  resetCode: document.querySelector("#reset-code"),
  run: document.querySelector("#run-button"),
  pause: document.querySelector("#pause-button"),
  step: document.querySelector("#step-button"),
  reset: document.querySelector("#reset-button"),
  clear: document.querySelector("#clear-button"),
  speed: document.querySelector("#speed-slider"),
  message: document.querySelector("#message-log"),
  status: document.querySelector("#status-pill"),
  registers: document.querySelector("#registers"),
  flags: document.querySelector("#flags"),
  pc: document.querySelector("#pc-value"),
  instruction: document.querySelector("#current-instruction"),
  memory: document.querySelector("#memory-grid"),
  changes: document.querySelector("#change-list"),
  canvas: document.querySelector("#pixel-display"),
  learnTab: document.querySelector("#learn-tab"),
  cPlaygroundTab: document.querySelector("#c-playground-tab"),
  asmPlaygroundTab: document.querySelector("#asm-playground-tab"),
  viewTabs: [...document.querySelectorAll("[data-view-tab]")],
  views: {
    learn: document.querySelector("#learn-view"),
    cPlayground: document.querySelector("#c-playground-view"),
    asmPlayground: document.querySelector("#asm-playground-view"),
  },
  cPlaygroundEditor: document.querySelector("#c-playground-editor"),
  cCompile: document.querySelector("#c-compile-button"),
  cGeneratedAssembly: document.querySelector("#c-generated-assembly"),
  cDiagnostics: document.querySelector("#c-diagnostics"),
  cCompilerSource: document.querySelector("#c-compiler-source"),
  asmPlaygroundEditor: document.querySelector("#asm-playground-editor"),
  asmPlaygroundResetCode: document.querySelector("#asm-playground-reset-code"),
  asmPlaygroundRun: document.querySelector("#asm-playground-run"),
  asmPlaygroundPause: document.querySelector("#asm-playground-pause"),
  asmPlaygroundStep: document.querySelector("#asm-playground-step"),
  asmPlaygroundReset: document.querySelector("#asm-playground-reset"),
  asmPlaygroundDiagnostics: document.querySelector("#asm-playground-diagnostics"),
  asmPlaygroundRegisters: document.querySelector("#asm-playground-registers"),
  asmPlaygroundFlags: document.querySelector("#asm-playground-flags"),
  asmPlaygroundPc: document.querySelector("#asm-playground-pc"),
  asmPlaygroundInstruction: document.querySelector("#asm-playground-instruction"),
  asmPlaygroundMemory: document.querySelector("#asm-playground-memory"),
  asmPlaygroundCanvas: document.querySelector("#asm-playground-display"),
  asmPlaygroundClear: document.querySelector("#asm-playground-clear"),
};

let missionIndex = 0;
let languageMode = "asm";
let activeView = "learn";
let state = createInitialState();
let program = parseProgram("");
let lastDiff = null;
let runTimer = null;
let compileErrors = [];
let runSteps = 0;
let hintIndex = 0;
const solvedMissionIds = new Set();
const RUN_STEP_LIMIT = 500;

const ctx = els.canvas.getContext("2d");
const asmPlaygroundCtx = els.asmPlaygroundCanvas.getContext("2d");
const defaultCPlaygroundSource = `int main() {
  int total = 2 + 3;
  return total;
}
`;
const defaultAsmPlaygroundSource = `MOV R0, 2
ADD R0, 3
STORE [0x10], R0
DRAW R0, R0
HALT
`;
const asmPlayground = {
  state: createInitialState(),
  program: parseProgram(defaultAsmPlaygroundSource),
  lastDiff: null,
  errors: [],
  timer: null,
  steps: 0,
};

function activeMission() {
  return missions[missionIndex];
}

function starterCodeFor(mission = activeMission()) {
  return languageMode === "asm" ? mission.assemblyCode : mission.tinyCCode;
}

function setStatus(text, tone = "neutral") {
  els.status.textContent = text;
  els.status.dataset.tone = tone;
}

function switchView(nextView) {
  activeView = nextView;
  stopRun();
  stopAsmPlaygroundRun();
  Object.entries(els.views).forEach(([name, view]) => {
    const viewName = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    view.dataset.active = String(viewName === activeView);
  });
  els.viewTabs.forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.viewTab === activeView));
  });
  const labels = {
    learn: ["Ready", "neutral"],
    "c-playground": ["C Playground", "active"],
    "asm-playground": ["ASM Playground", "active"],
  };
  const [label, tone] = labels[activeView] ?? labels.learn;
  setStatus(label, tone);
}

function compileCurrentProgram() {
  const source = els.editor.value;
  let assembly = source;
  let errors = [];

  if (languageMode === "c") {
    const compiled = compileTinyC(source);
    assembly = compiled.source;
    errors = compiled.errors;
  }

  program = parseProgram(assembly);
  errors.push(...program.errors);
  compileErrors = errors;
  els.generatedAssembly.textContent = assembly || "; no assembly yet";

  if (errors.length) {
    els.message.textContent = errors.join("\n");
    setStatus("Fix code", "warn");
    renderMissionFeedback({ stateName: "fail", title: "Compile blocked", detail: errors[0] });
  } else {
    els.message.textContent = languageMode === "c" ? "C compiled into assembly below." : "";
    setStatus(state.halted ? "Halted" : "Ready");
    if (!lastDiff) {
      renderMissionFeedback({ stateName: "idle" });
    }
  }
}

async function compileCPlayground() {
  const source = els.cPlaygroundEditor.value;
  els.cCompile.disabled = true;
  els.cDiagnostics.textContent = "Compiling...";
  setStatus("Compiling C", "active");

  try {
    const response = await fetch("/api/compile/c", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: source }),
    });

    if (!response.ok) throw new Error(`Compiler API returned ${response.status}.`);

    const payload = await response.json();
    const assembly = payload.assembly ?? payload.asm ?? payload.source ?? "";
    const diagnostics = normalizeDiagnostics(payload.diagnostics)
      .concat(normalizeDiagnostics(payload.errors))
      .concat(normalizeDiagnostics(payload.warnings));
    els.cGeneratedAssembly.textContent = assembly || "; compiler returned no assembly";
    els.cDiagnostics.textContent = diagnostics.length ? diagnostics.join("\n") : "Compiled with /api/compile/c.";
    els.cCompilerSource.textContent = "API";
    setStatus(diagnostics.length ? "C diagnostics" : "C compiled", diagnostics.length ? "warn" : "good");
  } catch (error) {
    const compiled = compileTinyC(source);
    els.cGeneratedAssembly.textContent = compiled.source || "; local compiler returned no assembly";
    els.cDiagnostics.textContent = compiled.errors.length
      ? compiled.errors.join("\n")
      : `Compiled with local Tiny C fallback. ${error.message}`;
    els.cCompilerSource.textContent = "Local";
    setStatus(compiled.errors.length ? "Fix C" : "C compiled", compiled.errors.length ? "warn" : "good");
  } finally {
    els.cCompile.disabled = false;
  }
}

function normalizeDiagnostics(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function compileAsmPlayground() {
  asmPlayground.program = parseProgram(els.asmPlaygroundEditor.value);
  asmPlayground.errors = asmPlayground.program.errors;
  if (asmPlayground.errors.length) {
    els.asmPlaygroundDiagnostics.textContent = asmPlayground.errors.join("\n");
    setStatus("Fix ASM", "warn");
  } else {
    els.asmPlaygroundDiagnostics.textContent = asmPlayground.state.halted ? "Halted." : "Ready.";
    if (activeView === "asm-playground") setStatus("ASM ready", "active");
  }
}

function resetAsmPlayground({ resetCode = false } = {}) {
  stopAsmPlaygroundRun();
  asmPlayground.state = createInitialState();
  asmPlayground.lastDiff = null;
  asmPlayground.steps = 0;
  if (resetCode) els.asmPlaygroundEditor.value = defaultAsmPlaygroundSource;
  compileAsmPlayground();
  renderAsmPlayground();
}

function stepAsmPlayground() {
  compileAsmPlayground();
  if (asmPlayground.errors.length) return;

  const result = stepMachine(asmPlayground.state, asmPlayground.program);
  asmPlayground.state = result.state;
  asmPlayground.lastDiff = result.diff;
  if (result.error) {
    els.asmPlaygroundDiagnostics.textContent = result.error;
    setStatus("ASM stopped", "warn");
    stopAsmPlaygroundRun();
  } else if (asmPlayground.state.halted) {
    els.asmPlaygroundDiagnostics.textContent = "Program halted.";
    setStatus("ASM halted", "good");
    stopAsmPlaygroundRun();
  } else {
    els.asmPlaygroundDiagnostics.textContent = result.diff.instruction
      ? `Stepped: ${result.diff.instruction}`
      : "Stepped.";
  }
  renderAsmPlayground();
}

function runAsmPlaygroundStep() {
  asmPlayground.steps += 1;
  if (asmPlayground.steps > RUN_STEP_LIMIT) {
    stopAsmPlaygroundRun();
    els.asmPlaygroundDiagnostics.textContent = `Paused after ${RUN_STEP_LIMIT} steps. Check for an infinite loop.`;
    setStatus("ASM paused", "warn");
    return;
  }
  stepAsmPlayground();
}

function startAsmPlaygroundRun() {
  if (asmPlayground.timer) return;
  asmPlayground.steps = 0;
  setStatus("ASM running", "active");
  asmPlayground.timer = setInterval(runAsmPlaygroundStep, 140);
}

function stopAsmPlaygroundRun() {
  if (!asmPlayground.timer) return;
  clearInterval(asmPlayground.timer);
  asmPlayground.timer = null;
  if (!asmPlayground.state.halted && activeView === "asm-playground") setStatus("ASM paused");
}

function resetMachine({ resetCode = false } = {}) {
  stopRun();
  state = createInitialState();
  lastDiff = null;
  runSteps = 0;
  if (resetCode) {
    els.editor.value = starterCodeFor().trim() + "\n";
  }
  compileCurrentProgram();
  render();
}

function loadMission(index) {
  missionIndex = index;
  hintIndex = 0;
  const mission = activeMission();
  els.missionTitle.textContent = mission.title;
  els.missionObjective.textContent = mission.objective;
  els.missionExplanation.textContent = mission.explanation;
  els.editor.value = starterCodeFor(mission).trim() + "\n";
  resetMachine();
}

function switchLanguage(nextMode) {
  if (languageMode === nextMode) return;
  languageMode = nextMode;
  els.asmMode.setAttribute("aria-pressed", String(languageMode === "asm"));
  els.cMode.setAttribute("aria-pressed", String(languageMode === "c"));
  els.modeLabel.textContent = languageMode === "asm" ? "ASM mode" : "C mode";
  els.editor.value = starterCodeFor().trim() + "\n";
  resetMachine();
}

function doStep() {
  compileCurrentProgram();
  if (compileErrors.length) return;

  const result = stepMachine(state, program);
  state = result.state;
  lastDiff = result.diff;
  if (result.error) {
    els.message.textContent = result.error;
    setStatus("Stopped", "warn");
    stopRun();
  }

  const missionResult = validateLesson(activeMission(), state);
  if (missionResult.passed) {
    markMissionSolved();
    setStatus(activeMission().points ? "Mission complete" : "Free play active", "good");
    stopRun();
  } else if (state.halted) {
    setStatus("Target missed", "warn");
    stopRun();
  }

  render(missionResult);
}

function showNextHint() {
  const hints = activeMission().hints ?? [];
  if (!hints.length) {
    els.coachTitle.textContent = "No hint needed";
    els.coachCopy.textContent = "This mode is for experiments. Change code and watch the machine react.";
    return;
  }
  const hint = hints[Math.min(hintIndex, hints.length - 1)];
  hintIndex += 1;
  els.coachTitle.textContent = `Hint ${Math.min(hintIndex, hints.length)} of ${hints.length}`;
  els.coachCopy.textContent = hint;
}

function doRunStep() {
  runSteps += 1;
  if (runSteps > RUN_STEP_LIMIT) {
    stopRun();
    setStatus("Loop paused", "warn");
    els.message.textContent = `Paused after ${RUN_STEP_LIMIT} steps. This may be an infinite loop, or your code may need a changing counter.`;
    renderMissionFeedback({
      stateName: "fail",
      title: "Loop paused",
      detail: "The machine ran many steps without reaching a target. Check whether a counter changes inside your loop.",
    });
    return;
  }
  doStep();
}

function markMissionSolved() {
  const mission = activeMission();
  if (!mission.points || solvedMissionIds.has(mission.id)) return;
  solvedMissionIds.add(mission.id);
  renderScore();
}

function renderScore() {
  const scoredMissions = missions.filter((mission) => mission.points);
  const score = missions
    .filter((mission) => solvedMissionIds.has(mission.id))
    .reduce((sum, mission) => sum + mission.points, 0);
  els.score.textContent = String(score);
  els.solved.textContent = `${solvedMissionIds.size}/${scoredMissions.length}`;
  els.boardCount.textContent = `${solvedMissionIds.size}/${scoredMissions.length} missions cleared`;
  els.progressFill.style.width = `${Math.round((solvedMissionIds.size / scoredMissions.length) * 100)}%`;
}

function startRun() {
  if (runTimer) return;
  runSteps = 0;
  setStatus("Running", "active");
  const delay = 520 - Number(els.speed.value) * 45;
  runTimer = setInterval(doRunStep, Math.max(60, delay));
}

function stopRun() {
  if (!runTimer) return;
  clearInterval(runTimer);
  runTimer = null;
  if (!state.halted) setStatus("Paused");
}

function renderRegisters() {
  const changed = new Set(lastDiff?.registers?.map((entry) => entry.name) ?? []);
  els.registers.innerHTML = "";
  state.registers.forEach((value, index) => {
    const item = document.createElement("div");
    item.className = "register-card";
    if (changed.has(`R${index}`)) item.classList.add("changed");
    item.innerHTML = `<span>R${index}</span><strong>${hex(value)}</strong><small>${value}</small>`;
    els.registers.append(item);
  });

  els.pc.textContent = String(state.pc);
  els.flags.innerHTML = "";
  Object.entries(state.flags).forEach(([name, value]) => {
    const flag = document.createElement("div");
    flag.className = value ? "flag on" : "flag";
    flag.textContent = `${name.toUpperCase()}: ${value ? 1 : 0}`;
    els.flags.append(flag);
  });
}

function renderMemory() {
  const reads = new Set(lastDiff?.memoryReads ?? []);
  const writes = new Set(lastDiff?.memoryWrites?.map((entry) => entry.address) ?? []);
  els.memory.innerHTML = "";
  for (let address = 0; address < state.memory.length; address += 1) {
    const cell = document.createElement("div");
    cell.className = "memory-cell";
    if (reads.has(address)) cell.classList.add("read");
    if (writes.has(address)) cell.classList.add("write");
    cell.title = `${hex(address)} = ${hex(state.memory[address])}`;
    cell.textContent = state.memory[address].toString(16).padStart(2, "0").toUpperCase();
    els.memory.append(cell);
  }
}

function renderDisplay() {
  const scaleX = els.canvas.width / state.displayWidth;
  const scaleY = els.canvas.height / state.displayHeight;
  ctx.fillStyle = "#f8faf7";
  ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);
  ctx.fillStyle = "#14231f";
  for (let y = 0; y < state.displayHeight; y += 1) {
    for (let x = 0; x < state.displayWidth; x += 1) {
      if (state.display[y * state.displayWidth + x]) {
        ctx.fillRect(x * scaleX, y * scaleY, scaleX - 1, scaleY - 1);
      }
    }
  }
}

function renderAsmPlaygroundRegisters() {
  const changed = new Set(asmPlayground.lastDiff?.registers?.map((entry) => entry.name) ?? []);
  els.asmPlaygroundRegisters.innerHTML = "";
  asmPlayground.state.registers.forEach((value, index) => {
    const item = document.createElement("div");
    item.className = "register-card";
    if (changed.has(`R${index}`)) item.classList.add("changed");
    item.innerHTML = `<span>R${index}</span><strong>${hex(value)}</strong><small>${value}</small>`;
    els.asmPlaygroundRegisters.append(item);
  });

  els.asmPlaygroundPc.textContent = String(asmPlayground.state.pc);
  els.asmPlaygroundFlags.innerHTML = "";
  Object.entries(asmPlayground.state.flags).forEach(([name, value]) => {
    const flag = document.createElement("div");
    flag.className = value ? "flag on" : "flag";
    flag.textContent = `${name.toUpperCase()}: ${value ? 1 : 0}`;
    els.asmPlaygroundFlags.append(flag);
  });
}

function renderAsmPlaygroundMemory() {
  const reads = new Set(asmPlayground.lastDiff?.memoryReads ?? []);
  const writes = new Set(asmPlayground.lastDiff?.memoryWrites?.map((entry) => entry.address) ?? []);
  els.asmPlaygroundMemory.innerHTML = "";
  for (let address = 0; address < asmPlayground.state.memory.length; address += 1) {
    const cell = document.createElement("div");
    cell.className = "memory-cell";
    if (reads.has(address)) cell.classList.add("read");
    if (writes.has(address)) cell.classList.add("write");
    cell.title = `${hex(address)} = ${hex(asmPlayground.state.memory[address])}`;
    cell.textContent = asmPlayground.state.memory[address].toString(16).padStart(2, "0").toUpperCase();
    els.asmPlaygroundMemory.append(cell);
  }
}

function renderAsmPlaygroundDisplay() {
  const scaleX = els.asmPlaygroundCanvas.width / asmPlayground.state.displayWidth;
  const scaleY = els.asmPlaygroundCanvas.height / asmPlayground.state.displayHeight;
  asmPlaygroundCtx.fillStyle = "#f8faf7";
  asmPlaygroundCtx.fillRect(0, 0, els.asmPlaygroundCanvas.width, els.asmPlaygroundCanvas.height);
  asmPlaygroundCtx.fillStyle = "#14231f";
  for (let y = 0; y < asmPlayground.state.displayHeight; y += 1) {
    for (let x = 0; x < asmPlayground.state.displayWidth; x += 1) {
      if (asmPlayground.state.display[y * asmPlayground.state.displayWidth + x]) {
        asmPlaygroundCtx.fillRect(x * scaleX, y * scaleY, scaleX - 1, scaleY - 1);
      }
    }
  }
}

function renderAsmPlayground() {
  const instruction =
    asmPlayground.program.instructions[asmPlayground.state.pc] ??
    asmPlayground.program.instructions[asmPlayground.state.pc - 1];
  els.asmPlaygroundInstruction.textContent = instruction ? instruction.source : "HALT";
  renderAsmPlaygroundRegisters();
  renderAsmPlaygroundMemory();
  renderAsmPlaygroundDisplay();
}

function renderChanges(missionResult = validateLesson(activeMission(), state)) {
  const instruction = program.instructions[state.pc] ?? program.instructions[state.pc - 1];
  els.instruction.textContent = instruction ? instruction.source : "HALT";

  const notes = [];
  if (lastDiff?.registers?.length) {
    lastDiff.registers.forEach((entry) => {
      notes.push(`${entry.name} changed from ${hex(entry.before)} to ${hex(entry.after)}.`);
    });
  }
  if (lastDiff?.memoryReads?.length) {
    lastDiff.memoryReads.forEach((address) => {
      notes.push(`Memory ${hex(address)} was read.`);
    });
  }
  if (lastDiff?.memoryWrites?.length) {
    lastDiff.memoryWrites.forEach((entry) => {
      notes.push(`Memory ${hex(entry.address)} now stores ${hex(entry.after)}.`);
    });
  }
  if (lastDiff?.displayWrites?.length) {
    lastDiff.displayWrites.forEach((entry) => {
      notes.push(`Pixel (${entry.x}, ${entry.y}) turned ${entry.value ? "on" : "off"}.`);
    });
  }
  if (!notes.length) notes.push("Run, step, or change the code to see the machine react.");
  if (missionResult.passed) notes.push(activeMission().points ? `Objective complete. +${activeMission().points} points.` : "Free play objective reached.");
  if (!missionResult.passed && missionResult.failed?.length) notes.push(`Target: ${missionResult.failed[0]}`);

  els.changes.innerHTML = "";
  notes.forEach((note) => {
    const item = document.createElement("li");
    item.textContent = note;
    els.changes.append(item);
  });
}

function render(missionResult) {
  renderScore();
  renderMissionBoard();
  renderMissionFeedback(missionFeedbackState(missionResult ?? validateLesson(activeMission(), state)));
  renderCoach(missionResult ?? validateLesson(activeMission(), state));
  renderRegisters();
  renderMemory();
  renderDisplay();
  renderChanges(missionResult);
}

function renderCoach(missionResult) {
  if (compileErrors.length) {
    els.coachTitle.textContent = "Fix the syntax first";
    els.coachCopy.textContent = "Run is blocked until the code compiles. Check the error below the editor.";
    return;
  }
  if (missionResult.passed) {
    els.coachTitle.textContent = "Target cleared";
    els.coachCopy.textContent = "Pick the next mission on the path, or open Free Play and experiment.";
    return;
  }
  if (state.halted && missionResult.failed?.length) {
    els.coachTitle.textContent = "Target missed";
    els.coachCopy.textContent = missionResult.failed[0];
    return;
  }
  if (lastDiff) {
    els.coachTitle.textContent = "Watch what changed";
    els.coachCopy.textContent = "Changed values are highlighted. Step again, or edit the code if the target is moving the wrong way.";
    return;
  }
  els.coachTitle.textContent = "Your first move";
  els.coachCopy.textContent = activeMission().objective;
}

function missionFeedbackState(missionResult) {
  if (compileErrors.length) {
    return { stateName: "fail", title: "Compile blocked", detail: compileErrors[0] };
  }
  if (missionResult.passed) {
    return {
      stateName: "pass",
      title: activeMission().points ? "Target cleared" : "Free play active",
      detail: activeMission().points ? `Banked ${activeMission().points} points.` : "The machine made visible output.",
    };
  }
  if (state.halted && missionResult.failed?.length) {
    return { stateName: "fail", title: "Target missed", detail: missionResult.failed[0] };
  }
  if (lastDiff) {
    return {
      stateName: "checking",
      title: "CPU moving",
      detail: missionResult.failed?.[0] ?? "Press Step again, or use Run when you understand the next change.",
    };
  }
  return { stateName: "idle" };
}

function renderMissionFeedback({ stateName, title, detail } = { stateName: "idle" }) {
  const copy = {
    idle: ["Start with one step", "Press Step to run one instruction and see what changed."],
    checking: ["CPU moving", "Watch the highlighted panels, then decide whether to step again or edit."],
    pass: ["Target cleared", "Mission objective satisfied."],
    fail: ["Target missed", "Use the target message below, adjust the code, and try Step again."],
  };
  const [defaultTitle, defaultDetail] = copy[stateName] ?? copy.idle;
  els.missionFeedback.dataset.state = stateName;
  els.missionFeedback.replaceChildren();
  const heading = document.createElement("strong");
  const body = document.createElement("span");
  heading.textContent = title ?? defaultTitle;
  body.textContent = detail ?? defaultDetail;
  els.missionFeedback.append(heading, body);
}

function renderMissionBoard() {
  els.missionBoard.innerHTML = "";
  missions.forEach((mission, index) => {
    const card = document.createElement("button");
    const isActive = index === missionIndex;
    const isSolved = solvedMissionIds.has(mission.id);
    card.type = "button";
    card.className = "mission-card";
    card.dataset.active = String(isActive);
    card.dataset.solved = String(isSolved);
    card.setAttribute("aria-current", isActive ? "step" : "false");
    card.innerHTML = `
      <span>${mission.points ? `${mission.points} pts` : "sandbox"}</span>
      <strong>${mission.title}</strong>
      <small>${isSolved ? "cleared" : isActive ? "current lesson" : "choose next"}</small>
    `;
    card.addEventListener("click", () => {
      els.missionSelect.value = String(index);
      loadMission(index);
    });
    els.missionBoard.append(card);
  });
}

function hex(value) {
  return `0x${Number(value & 255).toString(16).padStart(2, "0").toUpperCase()}`;
}

function setupMissions() {
  missions.forEach((mission, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = mission.points ? `${mission.title} (${mission.points} pts)` : mission.title;
    els.missionSelect.append(option);
  });
  els.modeLabel.textContent = "ASM mode";
}

function setupPlaygrounds() {
  els.cPlaygroundEditor.value = defaultCPlaygroundSource;
  els.asmPlaygroundEditor.value = defaultAsmPlaygroundSource;
  compileAsmPlayground();
  renderAsmPlayground();
}

els.viewTabs.forEach((tab) => {
  tab.addEventListener("click", () => switchView(tab.dataset.viewTab));
});
els.missionSelect.addEventListener("change", () => loadMission(Number(els.missionSelect.value)));
els.asmMode.addEventListener("click", () => switchLanguage("asm"));
els.cMode.addEventListener("click", () => switchLanguage("c"));
els.editor.addEventListener("input", compileCurrentProgram);
els.resetCode.addEventListener("click", () => resetMachine({ resetCode: true }));
els.step.addEventListener("click", doStep);
els.run.addEventListener("click", startRun);
els.pause.addEventListener("click", stopRun);
els.reset.addEventListener("click", () => resetMachine());
els.hint.addEventListener("click", showNextHint);
els.clear.addEventListener("click", () => {
  state.display.fill(0);
  render();
});
els.speed.addEventListener("input", () => {
  if (runTimer) {
    stopRun();
    startRun();
  }
});
els.cCompile.addEventListener("click", compileCPlayground);
els.asmPlaygroundEditor.addEventListener("input", compileAsmPlayground);
els.asmPlaygroundResetCode.addEventListener("click", () => resetAsmPlayground({ resetCode: true }));
els.asmPlaygroundStep.addEventListener("click", stepAsmPlayground);
els.asmPlaygroundRun.addEventListener("click", startAsmPlaygroundRun);
els.asmPlaygroundPause.addEventListener("click", stopAsmPlaygroundRun);
els.asmPlaygroundReset.addEventListener("click", () => resetAsmPlayground());
els.asmPlaygroundClear.addEventListener("click", () => {
  asmPlayground.state.display.fill(0);
  renderAsmPlayground();
});

setupMissions();
setupPlaygrounds();
loadMission(0);
