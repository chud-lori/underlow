import assert from "node:assert/strict";
import { compileTinyC, createInitialState, parseProgram, stepMachine, validateLesson } from "../src/engine.js";
import { missions } from "../src/missions.js";

function runAssembly(source, limit = 500) {
  let state = createInitialState();
  const program = parseProgram(source);
  assert.deepEqual(program.errors, []);

  for (let step = 0; step < limit && !state.halted; step += 1) {
    state = stepMachine(state, program).state;
  }

  return state;
}

assert.equal(missions.length >= 8, true);
assert.equal(new Set(missions.map((mission) => mission.id)).size, missions.length, "mission ids should be unique");
assert.equal(
  missions.filter((mission) => mission.points > 0).reduce((sum, mission) => sum + mission.points, 0),
  800,
  "scored missions should total 800 points",
);
assert.equal(missions.filter((mission) => mission.points === 0).length, 1, "only free play should be unscored");

for (const mission of missions) {
  assert.equal(typeof mission.id, "string");
  assert.equal(typeof mission.title, "string");
  assert.equal(typeof mission.objective, "string");
  assert.equal(typeof mission.explanation, "string");
  assert.equal(typeof mission.points, "number");
  assert.equal(typeof mission.assemblyCode, "string");
  assert.equal(typeof mission.tinyCCode, "string");
  assert.equal(Array.isArray(mission.hints), true, `${mission.id} should provide hints`);
  assert.equal(mission.hints.length >= 2, true, `${mission.id} should provide at least two hints`);
  assert.equal(Array.isArray(mission.checks), true);
  assert.equal(mission.checks.length >= 1, true, `${mission.id} should define success checks`);
  assert.equal(parseProgram(mission.assemblyCode).errors.length, 0, `${mission.id} assembly should parse`);

  const tinyC = compileTinyC(mission.tinyCCode);
  assert.deepEqual(tinyC.errors, [], `${mission.id} C mode should compile`);
  assert.equal(parseProgram(tinyC.source).errors.length, 0, `${mission.id} compiled C mode should parse`);
}

for (const mission of missions.filter((mission) => mission.points > 0)) {
  const assemblyState = runAssembly(mission.assemblyCode);
  assert.equal(validateLesson(mission, assemblyState).passed, false, `${mission.id} assembly starter should need edits`);

  const tinyC = compileTinyC(mission.tinyCCode);
  const cState = runAssembly(tinyC.source);
  assert.equal(validateLesson(mission, cState).passed, false, `${mission.id} C starter should need edits`);
}

const solutions = new Map([
  ["register-spark", {
    assembly: "MOV R0, 7\nHALT",
    tinyC: "r0 = 7;\nhalt();",
  }],
  ["adder-gate", {
    assembly: "MOV R0, 5\nMOV R1, 3\nADD R0, R1\nHALT",
    tinyC: "r0 = 5;\nr1 = 3;\nr0 = r0 + r1;\nhalt();",
  }],
  ["overflow-pop", {
    assembly: "MOV R0, 255\nADD R0, 1\nHALT",
    tinyC: "r0 = 255;\nr0 = r0 + 1;\nhalt();",
  }],
  ["memory-cache", {
    assembly: "MOV R0, 42\nSTORE [0x20], R0\nHALT",
    tinyC: "r0 = 42;\nmem[0x20] = r0;\nhalt();",
  }],
  ["branch-door", {
    assembly: "MOV R0, 4\nMOV R1, 4\nCMP R0, R1\nJZ same\nMOV R3, 0\nHALT\nsame:\nMOV R3, 1\nHALT",
    tinyC: "r0 = 4;\nr1 = 4;\ncmp(r0, r1);\nifz same;\nr3 = 0;\nhalt();\nsame:\nr3 = 1;\nhalt();",
  }],
  ["pixel-key", {
    assembly: "MOV R0, 10\nMOV R1, 5\nDRAW R0, R1\nHALT",
    tinyC: "r0 = 10;\nr1 = 5;\ndraw(r0, r1);\nhalt();",
  }],
  ["line-runner", {
    assembly: "MOV R0, 0\nMOV R1, 12\nloop:\nDRAW R0, R1\nINC R0\nCMP R0, 8\nJNZ loop\nHALT",
    tinyC: "r0 = 0;\nr1 = 12;\nloop:\ndraw(r0, r1);\nr0++;\ncmp(r0, 8);\nifnz loop;\nhalt();",
  }],
]);

for (const mission of missions.filter((mission) => mission.points > 0)) {
  const solution = solutions.get(mission.id);
  assert.ok(solution, `${mission.id} should have a QA solution`);
  assert.equal(validateLesson(mission, runAssembly(solution.assembly)).passed, true, `${mission.id} assembly solution should pass`);

  const tinyC = compileTinyC(solution.tinyC);
  assert.deepEqual(tinyC.errors, [], `${mission.id} C solution should compile`);
  assert.equal(validateLesson(mission, runAssembly(tinyC.source)).passed, true, `${mission.id} C solution should pass`);
}

{
  const solvedMissionIds = new Set();
  const score = () => missions
    .filter((mission) => solvedMissionIds.has(mission.id))
    .reduce((sum, mission) => sum + mission.points, 0);

  solvedMissionIds.add("register-spark");
  solvedMissionIds.add("register-spark");
  solvedMissionIds.add("free-play");

  assert.equal(score(), 50, "solving a mission twice and free play should not inflate score");
  assert.equal(solvedMissionIds.size, 2, "free play may be tracked separately from score");
}

const freePlay = missions.find((mission) => mission.id === "free-play");
assert.ok(freePlay);
assert.equal(freePlay.points, 0);
assert.equal(validateLesson(freePlay, runAssembly(freePlay.assemblyCode)).passed, true);

console.log("mission checks passed");
