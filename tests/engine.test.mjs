import assert from "node:assert/strict";
import { compileTinyC, createInitialState, parseProgram, stepMachine, validateLesson } from "../src/engine.js";

function run(source, limit = 200) {
  let state = createInitialState();
  const program = parseProgram(source);
  assert.deepEqual(program.errors, []);
  for (let i = 0; i < limit && !state.halted; i += 1) {
    state = stepMachine(state, program).state;
  }
  return state;
}

function stepOnce(source) {
  const program = parseProgram(source);
  assert.deepEqual(program.errors, []);
  return stepMachine(createInitialState(), program);
}

{
  const state = run(`
MOV R0, 5
ADD R0, 3
HALT
`);
  assert.equal(state.registers[0], 8);
}

{
  const state = run(`
MOV R0, 255
ADD R0, 1
HALT
`);
  assert.equal(state.registers[0], 0);
  assert.equal(state.flags.c, true);
}

{
  const state = run(`
MOV R0, 0xF0
AND R0, 0x0F
OR R0, 0x80
XOR R0, 0x81
NOT R0
HALT
`);
  assert.equal(state.registers[0], 0xFE);
  assert.equal(state.flags.z, false);
  assert.equal(state.flags.c, false);
  assert.equal(state.flags.n, true);
}

{
  const state = run(`
MOV R0, 0x81
SHL R0, 1
SHR R0, 1
HALT
`);
  assert.equal(state.registers[0], 1);
  assert.equal(state.flags.z, false);
  assert.equal(state.flags.c, false);
  assert.equal(state.flags.n, false);
}

{
  const state = run(`
MOV R0, 0x81
SHR R0, 1
HALT
`);
  assert.equal(state.registers[0], 0x40);
  assert.equal(state.flags.c, true);
  assert.equal(state.flags.n, false);
}

{
  const state = run(`
MOV R0, 0x80
SHL R0, 8
HALT
`);
  assert.equal(state.registers[0], 0);
  assert.equal(state.flags.z, true);
  assert.equal(state.flags.c, true);
  assert.equal(state.flags.n, false);
}

{
  const { state, diff } = stepOnce("XOR R0, R0");
  assert.equal(state.registers[0], 0);
  assert.deepEqual(diff.flags, [{ name: "z", before: false, after: true }]);
}

{
  const { diff } = stepOnce("NOT R0");
  assert.deepEqual(diff.registers, [{ name: "R0", before: 0, after: 255 }]);
  assert.deepEqual(diff.flags, [{ name: "n", before: false, after: true }]);
}

{
  const result = stepOnce("SHL R0, -1");
  assert.equal(result.state.halted, true);
  assert.match(result.error, /Shift amount must be 0 or greater/);
}

{
  const state = run(`
MOV R0, 42
STORE [0x20], R0
LOAD R1, [0x20]
HALT
`);
  assert.equal(state.memory[0x20], 42);
  assert.equal(state.registers[1], 42);
}

{
  const state = run(`
MOV R0, 2
MOV R1, 2
CMP R0, R1
JZ same
MOV R2, 9
HALT
same:
MOV R2, 1
HALT
`);
  assert.equal(state.registers[2], 1);
}

{
  const compiled = compileTinyC(`
r0 = 5;
r1 = 3;
r0 = r0 + r1;
halt();
`);
  assert.deepEqual(compiled.errors, []);
  const state = run(compiled.source);
  assert.equal(state.registers[0], 8);
}

{
  const compiled = compileTinyC(`
int i;
i = 7;
halt();
`);
  assert.deepEqual(compiled.errors, []);
  assert.match(compiled.source, /; int i -> R0/);
  assert.match(compiled.source, /MOV R0, 0/);
  assert.match(compiled.source, /MOV R0, 7/);
  const state = run(compiled.source);
  assert.equal(state.registers[0], 7);
}

{
  const compiled = compileTinyC(`
int x = 5;
int y = 3;
x = x + y;
mem[0x20] = x;
halt();
`);
  assert.deepEqual(compiled.errors, []);
  assert.match(compiled.source, /; int x -> R0/);
  assert.match(compiled.source, /; int y -> R1/);
  assert.match(compiled.source, /ADD R0, R1/);
  assert.match(compiled.source, /STORE \[0x20\], R0/);
  const state = run(compiled.source);
  assert.equal(state.registers[0], 8);
  assert.equal(state.memory[0x20], 8);
}

{
  const compiled = compileTinyC(`
r0 = 0;
r1 = 2;
while (r0 != 8) { draw(r0, r1); r0++; }
halt();
`);
  assert.deepEqual(compiled.errors, []);
  assert.match(compiled.source, /__tiny_while_\d+:/);
  assert.match(compiled.source, /CMP R0, 8/);
  assert.match(compiled.source, /JZ __tiny_endwhile_\d+/);
  assert.match(compiled.source, /JMP __tiny_while_\d+/);

  const state = run(compiled.source);
  assert.equal(state.registers[0], 8);
  for (let x = 0; x < 8; x += 1) {
    assert.equal(state.display[2 * state.displayWidth + x], 1);
  }
  assert.equal(state.display[2 * state.displayWidth + 8], 0);
}

{
  const compiled = compileTinyC(`
int i = 0;
int row = 2;
while (i != 8) {
  draw(i, row);
  i++;
}
halt();
`);
  assert.deepEqual(compiled.errors, []);
  assert.match(compiled.source, /CMP R0, 8/);
  assert.match(compiled.source, /DRAW R0, R1/);
  const state = run(compiled.source);
  assert.equal(state.registers[0], 8);
  for (let x = 0; x < 8; x += 1) {
    assert.equal(state.display[2 * state.displayWidth + x], 1);
  }
}

{
  const compiled = compileTinyC(`
int main() {
  int i;
  i = 7;
  return 0;
}
`);
  assert.deepEqual(compiled.errors, []);
  assert.match(compiled.source, /; int i -> R0/);
  assert.match(compiled.source, /MOV R0, 0/);
  assert.match(compiled.source, /MOV R0, 7/);
  assert.match(compiled.source, /HALT/);
  const state = run(compiled.source);
  assert.equal(state.registers[0], 7);
}

{
  const compiled = compileTinyC(`
int main() {
  int i;
  int row = 3;
  for (i = 0; i < 8; i++) {
    draw(i, row);
  }
  return 0;
}
`);
  assert.deepEqual(compiled.errors, []);
  assert.match(compiled.source, /__tiny_for_\d+:/);
  assert.match(compiled.source, /CMP R0, 8/);
  assert.match(compiled.source, /JGE __tiny_endfor_\d+/);
  assert.match(compiled.source, /INC R0/);
  const state = run(compiled.source);
  assert.equal(state.registers[0], 8);
  for (let x = 0; x < 8; x += 1) {
    assert.equal(state.display[3 * state.displayWidth + x], 1);
  }
}

{
  const compiled = compileTinyC(`
r0 = 4;
if (r0 == 4) {
  r1 = 9;
}
if (r0 != 4) {
  r1 = 1;
}
halt();
`);
  assert.deepEqual(compiled.errors, []);
  assert.match(compiled.source, /CMP R0, 4\nJNZ __tiny_endif_\d+/);
  assert.match(compiled.source, /CMP R0, 4\nJZ __tiny_endif_\d+/);

  const state = run(compiled.source);
  assert.equal(state.registers[1], 9);
}

{
  const compiled = compileTinyC(`
int main() {
  int i = 2;
  if (i >= 3) {
    i = 9;
  } else {
    i = 4;
  }
  return 0;
}
`);
  assert.deepEqual(compiled.errors, []);
  assert.match(compiled.source, /CMP R0, 3/);
  assert.match(compiled.source, /JLT __tiny_else_\d+/);
  assert.match(compiled.source, /JMP __tiny_endif_\d+/);
  const state = run(compiled.source);
  assert.equal(state.registers[0], 4);
}

{
  const state = run(`
MOV R0, 3
MOV R1, 4
DRAW R0, R1
HALT
`);
  assert.equal(state.display[4 * state.displayWidth + 3], 1);
  assert.equal(validateLesson({ checks: [{ type: "pixelOn", x: 3, y: 4 }] }, state).passed, true);
}

{
  const compiled = compileTinyC(`
int i = 4;
if (i == 4) {
  i = i + 5;
}
halt();
`);
  assert.deepEqual(compiled.errors, []);
  assert.match(compiled.source, /CMP R0, 4/);
  const state = run(compiled.source);
  assert.equal(state.registers[0], 9);
}

{
  const compiled = compileTinyC(`
int main() {
  int i = 0;
  int sum = 0;
  for (i = 0; i <= 3; i++) {
    if (i > 1) {
      sum = sum + i;
    }
  }
  mem[0x2A] = sum;
  return 0;
}
`);
  assert.deepEqual(compiled.errors, []);
  assert.match(compiled.source, /JGT __tiny_else_\d+|JLE __tiny_endif_\d+/);
  assert.match(compiled.source, /STORE \[0x2A\], R1/);
  const state = run(compiled.source);
  assert.equal(state.registers[0], 4);
  assert.equal(state.registers[1], 5);
  assert.equal(state.memory[0x2A], 5);
}

{
  const compiled = compileTinyC(`
int a;
int b;
int c;
int d;
int e;
int f;
int g;
int h;
int overflow;
`);
  assert.deepEqual(compiled.errors, ['Line 10: no free registers left for "overflow".']);
  assert.equal(compiled.source, "");
}

{
  const compiled = compileTinyC(`
int main() {
  int i = 1;
  i = missing + 1;
}
`);
  assert.equal(compiled.errors.length, 1);
  assert.match(compiled.errors[0], /Expected register or number, got "missing\s*"\./);
  assert.equal(compiled.source, "");
}

{
  const compiled = compileTinyC(`
r0 = 1;
spin(r0);
halt();
`);
  assert.deepEqual(compiled.errors, ['Line 3: cannot compile "spin(r0)".']);
}

{
  const state = createInitialState();
  const program = parseProgram(`
JMP missing
MOV R0, 99
`);
  assert.equal(program.errors.length, 1);
  const result = stepMachine(state, program);

  assert.equal(result.error, 'Line 2: unknown label "missing".');
  assert.equal(result.state.halted, true);
  assert.equal(result.state.registers[0], 0, "parse errors should block execution before mutation");
}

{
  const state = createInitialState();
  const program = parseProgram(`
WAT R0, 1
`);
  const result = stepMachine(state, program);

  assert.equal(result.error, 'Line 2: unknown instruction "WAT".');
  assert.equal(result.state.halted, true);
  assert.equal(result.state.pc, 0, "runtime instruction errors should stop at the failing instruction");
}

{
  const state = createInitialState();
  const program = parseProgram("STORE [256], 1");
  assert.deepEqual(program.errors, []);
  const result = stepMachine(state, program);

  assert.equal(result.error, "Memory address 256 is outside 0..255.");
  assert.equal(result.state.halted, true);
  assert.equal(result.state.memory[0], 0, "out-of-range stores should not wrap into memory");
}

console.log("engine tests passed");
