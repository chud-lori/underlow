export const missions = [
  {
    id: "register-spark",
    title: "Register Spark",
    points: 50,
    objective: "Edit the starter so R0 holds exactly 7, then halt.",
    explanation: "The machine starts with all registers at 0. Your job is to move one exact value into one exact register.",
    hints: [
      "MOV copies the value on the right into the register on the left.",
      "Only R0 is checked here; other registers can stay untouched.",
    ],
    assemblyCode: `
; Challenge: make R0 equal 7.
MOV R0, 0
HALT
`,
    tinyCCode: `
// Challenge: make r0 equal 7.
r0 = 0;
halt();
`,
    checks: [
      { type: "registerEquals", register: 0, value: 7, message: "R0 should contain 7." },
      { type: "halted", message: "End the program with HALT or halt()." },
    ],
  },
  {
    id: "adder-gate",
    title: "Adder Gate",
    points: 80,
    objective: "Combine two values so R0 finishes at 8.",
    explanation: "Arithmetic changes state in place: ADD keeps the answer in its first register. Fix the missing setup value.",
    hints: [
      "The starter already adds R1 into R0.",
      "Choose values that add to 8 before the HALT runs.",
    ],
    assemblyCode: `
; Challenge: make the final value in R0 equal 8.
MOV R0, 5
MOV R1, 0
ADD R0, R1
HALT
`,
    tinyCCode: `
// Challenge: make the final value in r0 equal 8.
r0 = 5;
r1 = 0;
r0 = r0 + r1;
halt();
`,
    checks: [
      { type: "registerEquals", register: 0, value: 8, message: "R0 should contain 8." },
      { type: "halted", message: "Stop the machine when the target is reached." },
    ],
  },
  {
    id: "overflow-pop",
    title: "Overflow Pop",
    points: 100,
    objective: "Use one-byte overflow so 255 plus 1 wraps R0 back to 0.",
    explanation: "Registers are only one byte wide. When a result passes 255, the extra bit falls away and the stored value wraps.",
    hints: [
      "Start R0 at the largest one-byte value.",
      "Adding 1 to 255 produces the checked wraparound value.",
    ],
    assemblyCode: `
; Challenge: make R0 wrap to 0 by overflowing.
MOV R0, 254
ADD R0, 1
HALT
`,
    tinyCCode: `
// Challenge: make r0 wrap to 0 by overflowing.
r0 = 254;
r0 = r0 + 1;
halt();
`,
    checks: [
      { type: "registerEquals", register: 0, value: 0, message: "R0 should wrap to 0." },
      { type: "halted", message: "Stop after the wrap." },
    ],
  },
  {
    id: "memory-cache",
    title: "Memory Cache",
    points: 110,
    objective: "Store the value 42 at memory address 0x20.",
    explanation: "Memory keeps values after the register moves on. Aim for the checked address, not just the checked number.",
    hints: [
      "STORE [address], register writes a register into memory.",
      "The starter has the right value but the wrong memory address.",
    ],
    assemblyCode: `
; Challenge: store 42 at address 0x20.
MOV R0, 42
STORE [0x10], R0
HALT
`,
    tinyCCode: `
// Challenge: store 42 at address 0x20.
r0 = 42;
mem[0x10] = r0;
halt();
`,
    checks: [
      { type: "memoryEquals", address: 0x20, value: 42, message: "Memory address 0x20 should contain 42." },
      { type: "halted", message: "Stop after storing the value." },
    ],
  },
  {
    id: "branch-door",
    title: "Branch Door",
    points: 130,
    objective: "Use CMP and a zero-flag jump so R3 finishes at 1.",
    explanation: "CMP sets flags without changing the registers. JZ only takes the branch when the comparison result is zero.",
    hints: [
      "The branch target already writes the success value.",
      "Make the comparison equal so JZ walks through the door.",
    ],
    assemblyCode: `
; Challenge: reach the same: label so R3 becomes 1.
MOV R0, 4
MOV R1, 5
CMP R0, R1
JZ same
MOV R3, 0
HALT
same:
MOV R3, 1
HALT
`,
    tinyCCode: `
// Challenge: reach the same: label so r3 becomes 1.
r0 = 4;
r1 = 5;
cmp(r0, r1);
ifz same;
r3 = 0;
halt();
same:
r3 = 1;
halt();
`,
    checks: [
      { type: "registerEquals", register: 3, value: 1, message: "R3 should contain 1 after the matching branch." },
      { type: "halted", message: "Stop after the branch target." },
    ],
  },
  {
    id: "pixel-key",
    title: "Pixel Key",
    points: 150,
    objective: "Light the single pixel at x=10, y=5.",
    explanation: "DRAW reads x and y values from registers or numbers. The display check cares about the exact coordinate.",
    hints: [
      "R0 is used for x and R1 is used for y in the starter.",
      "Only one coordinate is wrong.",
    ],
    assemblyCode: `
; Challenge: draw at coordinate (10, 5).
MOV R0, 10
MOV R1, 4
DRAW R0, R1
HALT
`,
    tinyCCode: `
// Challenge: draw at coordinate (10, 5).
r0 = 10;
r1 = 4;
draw(r0, r1);
halt();
`,
    checks: [
      { type: "pixelOn", x: 10, y: 5, message: "The pixel at (10, 5) should be on." },
      { type: "halted", message: "Stop after drawing." },
    ],
  },
  {
    id: "line-runner",
    title: "Line Runner",
    points: 180,
    objective: "Draw at least 8 pixels by fixing the loop.",
    explanation: "Loops are just jumps that repeat earlier instructions. The counter must move toward the comparison value each lap.",
    hints: [
      "The loop stops when CMP makes the zero flag true.",
      "Something in the starter prevents the counter from advancing.",
    ],
    assemblyCode: `
; Challenge: draw at least 8 pixels across row 12.
MOV R0, 0
MOV R1, 12
loop:
DRAW R0, R1
CMP R0, 8
JNZ loop
HALT
`,
    tinyCCode: `
// Challenge: draw at least 8 pixels across row 12.
r0 = 0;
r1 = 12;
loop:
draw(r0, r1);
cmp(r0, 8);
ifnz loop;
halt();
`,
    checks: [
      { type: "minPixelsOn", count: 8, message: "At least 8 pixels should be on." },
      { type: "halted", message: "Stop after drawing the line." },
    ],
  },
  {
    id: "free-play",
    title: "Free Play: Draw Anything",
    points: 0,
    objective: "Experiment with code. No score target, just make the machine do something visible.",
    explanation: "Break things, change numbers, draw shapes, and watch the machine panels. This mode is for play.",
    hints: [
      "DRAW turns on one pixel at the x/y coordinate you give it.",
      "CLS clears the display before you try another shape.",
    ],
    assemblyCode: `
CLS
MOV R0, 2
MOV R1, 2
DRAW R0, R1
MOV R0, 3
DRAW R0, R1
MOV R0, 4
DRAW R0, R1
HALT
`,
    tinyCCode: `
cls();
r0 = 2;
r1 = 2;
draw(r0, r1);
r0++;
draw(r0, r1);
r0++;
draw(r0, r1);
halt();
`,
    checks: [
      { type: "minPixelsOn", count: 1, message: "Turn on at least one pixel." },
    ],
  },
];
