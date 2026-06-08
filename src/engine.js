const REGISTER_COUNT = 8;
const MEMORY_SIZE = 256;
const DISPLAY_WIDTH = 32;
const DISPLAY_HEIGHT = 24;

export function createInitialState() {
  return {
    registers: new Uint8Array(REGISTER_COUNT),
    memory: new Uint8Array(MEMORY_SIZE),
    display: new Uint8Array(DISPLAY_WIDTH * DISPLAY_HEIGHT),
    displayWidth: DISPLAY_WIDTH,
    displayHeight: DISPLAY_HEIGHT,
    pc: 0,
    flags: { z: false, c: false, n: false },
    halted: false,
    error: null,
  };
}

export function parseProgram(source) {
  const labels = new Map();
  const instructions = [];
  const errors = [];

  source.split(/\r?\n/).forEach((rawLine, lineIndex) => {
    const sourceLine = rawLine.replace(/;.*/, "").trim();
    if (!sourceLine) return;

    let rest = sourceLine;
    const labelMatch = rest.match(/^([A-Za-z_][\w]*):\s*(.*)$/);
    if (labelMatch) {
      const label = labelMatch[1];
      if (labels.has(label)) errors.push(`Line ${lineIndex + 1}: duplicate label "${label}".`);
      labels.set(label, instructions.length);
      rest = labelMatch[2].trim();
      if (!rest) return;
    }

    const [opToken, ...tail] = rest.split(/\s+/);
    const argsText = tail.join(" ");
    const args = argsText ? argsText.split(",").map((arg) => arg.trim()).filter(Boolean) : [];
    instructions.push({
      op: opToken.toUpperCase(),
      args,
      source: rest,
      line: lineIndex + 1,
    });
  });

  instructions.forEach((instruction) => {
    if (["JMP", "JZ", "JNZ", "JC", "JNC", "JLT", "JLE", "JGT", "JGE"].includes(instruction.op) && instruction.args[0]) {
      const target = instruction.args[0];
      if (!isNumber(target) && !labels.has(target)) {
        errors.push(`Line ${instruction.line}: unknown label "${target}".`);
      }
    }
  });

  return { instructions, labels, errors };
}

export function compileTinyC(source) {
  const lines = [];
  const errors = [];

  try {
    const parser = createTinyCParser(source);
    lines.push(...compileTinyBlock(parser, false));
  } catch (error) {
    errors.push(error.message);
  }

  return {
    source: lines.join("\n"),
    errors,
  };
}

export function stepMachine(currentState, program) {
  const state = cloneState(currentState);
  const diff = createDiff(state.pc);

  if (state.halted) return { state, diff };
  if (program.errors?.length) return stopWithError(state, diff, program.errors[0]);
  if (state.pc < 0 || state.pc >= program.instructions.length) {
    state.halted = true;
    return { state, diff };
  }

  const instruction = program.instructions[state.pc];
  diff.instruction = instruction.source;
  const nextPc = state.pc + 1;

  try {
    switch (instruction.op) {
      case "MOV": {
        requireArgs(instruction, 2);
        const reg = parseRegister(instruction.args[0]);
        const value = readValue(state, instruction.args[1], diff);
        writeRegister(state, diff, reg, value);
        state.pc = nextPc;
        break;
      }
      case "ADD": {
        requireArgs(instruction, 2);
        const reg = parseRegister(instruction.args[0]);
        const before = state.registers[reg];
        const value = readValue(state, instruction.args[1], diff);
        const raw = before + value;
        writeRegister(state, diff, reg, raw);
        setMathFlags(state, diff, raw, false);
        state.pc = nextPc;
        break;
      }
      case "SUB": {
        requireArgs(instruction, 2);
        const reg = parseRegister(instruction.args[0]);
        const before = state.registers[reg];
        const value = readValue(state, instruction.args[1], diff);
        const raw = before - value;
        writeRegister(state, diff, reg, raw);
        setMathFlags(state, diff, raw, true);
        state.pc = nextPc;
        break;
      }
      case "INC": {
        requireArgs(instruction, 1);
        const reg = parseRegister(instruction.args[0]);
        const raw = state.registers[reg] + 1;
        writeRegister(state, diff, reg, raw);
        setMathFlags(state, diff, raw, false);
        state.pc = nextPc;
        break;
      }
      case "DEC": {
        requireArgs(instruction, 1);
        const reg = parseRegister(instruction.args[0]);
        const raw = state.registers[reg] - 1;
        writeRegister(state, diff, reg, raw);
        setMathFlags(state, diff, raw, true);
        state.pc = nextPc;
        break;
      }
      case "AND": {
        requireArgs(instruction, 2);
        const reg = parseRegister(instruction.args[0]);
        const raw = state.registers[reg] & readValue(state, instruction.args[1], diff);
        writeRegister(state, diff, reg, raw);
        setBitwiseFlags(state, diff, raw, false);
        state.pc = nextPc;
        break;
      }
      case "OR": {
        requireArgs(instruction, 2);
        const reg = parseRegister(instruction.args[0]);
        const raw = state.registers[reg] | readValue(state, instruction.args[1], diff);
        writeRegister(state, diff, reg, raw);
        setBitwiseFlags(state, diff, raw, false);
        state.pc = nextPc;
        break;
      }
      case "XOR": {
        requireArgs(instruction, 2);
        const reg = parseRegister(instruction.args[0]);
        const raw = state.registers[reg] ^ readValue(state, instruction.args[1], diff);
        writeRegister(state, diff, reg, raw);
        setBitwiseFlags(state, diff, raw, false);
        state.pc = nextPc;
        break;
      }
      case "NOT": {
        requireArgs(instruction, 1);
        const reg = parseRegister(instruction.args[0]);
        const raw = ~state.registers[reg];
        writeRegister(state, diff, reg, raw);
        setBitwiseFlags(state, diff, raw, false);
        state.pc = nextPc;
        break;
      }
      case "SHL": {
        requireArgs(instruction, 2);
        const reg = parseRegister(instruction.args[0]);
        const amount = readShiftAmount(state, instruction.args[1], diff);
        const before = state.registers[reg];
        const raw = amount >= 8 ? 0 : before << amount;
        writeRegister(state, diff, reg, raw);
        setBitwiseFlags(state, diff, raw, amount > 0 && (amount >= 8 ? before !== 0 : (before << amount) > 255));
        state.pc = nextPc;
        break;
      }
      case "SHR": {
        requireArgs(instruction, 2);
        const reg = parseRegister(instruction.args[0]);
        const amount = readShiftAmount(state, instruction.args[1], diff);
        const before = state.registers[reg];
        const raw = amount >= 8 ? 0 : before >>> amount;
        const discardedMask = amount >= 8 ? 255 : (1 << amount) - 1;
        writeRegister(state, diff, reg, raw);
        setBitwiseFlags(state, diff, raw, amount > 0 && (before & discardedMask) !== 0);
        state.pc = nextPc;
        break;
      }
      case "LOAD": {
        requireArgs(instruction, 2);
        const reg = parseRegister(instruction.args[0]);
        const address = parseAddress(state, instruction.args[1], diff);
        diff.memoryReads.push(address);
        writeRegister(state, diff, reg, state.memory[address]);
        state.pc = nextPc;
        break;
      }
      case "STORE": {
        requireArgs(instruction, 2);
        const address = parseAddress(state, instruction.args[0], diff);
        const value = readValue(state, instruction.args[1], diff);
        writeMemory(state, diff, address, value);
        state.pc = nextPc;
        break;
      }
      case "CMP": {
        requireArgs(instruction, 2);
        const left = readValue(state, instruction.args[0], diff);
        const right = readValue(state, instruction.args[1], diff);
        const raw = left - right;
        setMathFlags(state, diff, raw, true);
        state.pc = nextPc;
        break;
      }
      case "JMP":
        requireArgs(instruction, 1);
        state.pc = resolveTarget(program, instruction.args[0]);
        break;
      case "JZ":
        requireArgs(instruction, 1);
        state.pc = state.flags.z ? resolveTarget(program, instruction.args[0]) : nextPc;
        break;
      case "JNZ":
        requireArgs(instruction, 1);
        state.pc = !state.flags.z ? resolveTarget(program, instruction.args[0]) : nextPc;
        break;
      case "JC":
      case "JLT":
        requireArgs(instruction, 1);
        state.pc = state.flags.c ? resolveTarget(program, instruction.args[0]) : nextPc;
        break;
      case "JNC":
      case "JGE":
        requireArgs(instruction, 1);
        state.pc = !state.flags.c ? resolveTarget(program, instruction.args[0]) : nextPc;
        break;
      case "JLE":
        requireArgs(instruction, 1);
        state.pc = state.flags.c || state.flags.z ? resolveTarget(program, instruction.args[0]) : nextPc;
        break;
      case "JGT":
        requireArgs(instruction, 1);
        state.pc = !state.flags.c && !state.flags.z ? resolveTarget(program, instruction.args[0]) : nextPc;
        break;
      case "DRAW": {
        requireArgs(instruction, 2);
        const x = readValue(state, instruction.args[0], diff) % DISPLAY_WIDTH;
        const y = readValue(state, instruction.args[1], diff) % DISPLAY_HEIGHT;
        const index = y * DISPLAY_WIDTH + x;
        state.display[index] = 1;
        diff.displayWrites.push({ x, y, value: 1 });
        state.pc = nextPc;
        break;
      }
      case "CLS":
        state.display.fill(0);
        diff.displayCleared = true;
        state.pc = nextPc;
        break;
      case "HALT":
        state.halted = true;
        state.pc = nextPc;
        break;
      default:
        throw new Error(`Line ${instruction.line}: unknown instruction "${instruction.op}".`);
    }
  } catch (error) {
    return stopWithError(state, diff, error.message);
  }

  diff.pcAfter = state.pc;
  return { state, diff };
}

export function validateLesson(lesson, state) {
  const failed = [];
  for (const check of lesson.checks ?? []) {
    if (check.type === "registerEquals" && state.registers[check.register] !== check.value) {
      failed.push(check.message);
    }
    if (check.type === "memoryEquals" && state.memory[check.address] !== check.value) {
      failed.push(check.message);
    }
    if (check.type === "pixelOn") {
      const index = check.y * state.displayWidth + check.x;
      if (state.display[index] !== 1) failed.push(check.message);
    }
    if (check.type === "minPixelsOn") {
      const count = state.display.reduce((sum, value) => sum + value, 0);
      if (count < check.count) failed.push(check.message);
    }
    if (check.type === "halted" && !state.halted) {
      failed.push(check.message);
    }
  }
  return { passed: failed.length === 0, failed };
}

function cloneState(state) {
  return {
    registers: new Uint8Array(state.registers),
    memory: new Uint8Array(state.memory),
    display: new Uint8Array(state.display),
    displayWidth: state.displayWidth,
    displayHeight: state.displayHeight,
    pc: state.pc,
    flags: { ...state.flags },
    halted: state.halted,
    error: state.error,
  };
}

function createDiff(pcBefore) {
  return {
    pcBefore,
    pcAfter: pcBefore,
    instruction: "",
    registers: [],
    flags: [],
    memoryReads: [],
    memoryWrites: [],
    displayWrites: [],
    displayCleared: false,
  };
}

function stopWithError(state, diff, message) {
  state.error = message;
  state.halted = true;
  return { state, diff, error: message };
}

function requireArgs(instruction, count) {
  if (instruction.args.length !== count) {
    throw new Error(`Line ${instruction.line}: ${instruction.op} expects ${count} argument(s).`);
  }
}

function parseRegister(token) {
  const match = /^R([0-7])$/i.exec(token);
  if (!match) throw new Error(`Expected a register like R0, got "${token}".`);
  return Number(match[1]);
}

function parseAddress(state, token, diff) {
  const match = /^\[(.+)\]$/.exec(token.trim());
  if (!match) throw new Error(`Expected a memory address like [0x20], got "${token}".`);
  const value = readValue(state, match[1].trim(), diff);
  if (value < 0 || value >= MEMORY_SIZE) throw new Error(`Memory address ${value} is outside 0..255.`);
  return value;
}

function readValue(state, token, diff) {
  const trimmed = token.trim();
  if (/^R[0-7]$/i.test(trimmed)) return state.registers[parseRegister(trimmed)];
  if (/^\[.+\]$/.test(trimmed)) {
    const address = parseAddress(state, trimmed, diff);
    diff.memoryReads.push(address);
    return state.memory[address];
  }
  if (isNumber(trimmed)) return parseNumber(trimmed);
  throw new Error(`Expected a number, register, or memory value, got "${token}".`);
}

function readShiftAmount(state, token, diff) {
  const amount = readValue(state, token, diff);
  if (amount < 0) throw new Error(`Shift amount must be 0 or greater, got ${amount}.`);
  return amount;
}

function writeRegister(state, diff, index, rawValue) {
  const before = state.registers[index];
  const after = rawValue & 255;
  state.registers[index] = after;
  if (before !== after) diff.registers.push({ name: `R${index}`, before, after });
}

function writeMemory(state, diff, address, rawValue) {
  const before = state.memory[address];
  const after = rawValue & 255;
  state.memory[address] = after;
  diff.memoryWrites.push({ address, before, after });
}

function setMathFlags(state, diff, raw, negative) {
  const value = raw & 255;
  setFlags(state, diff, {
    z: value === 0,
    c: raw < 0 || raw > 255,
    n: negative,
  });
}

function setBitwiseFlags(state, diff, raw, carry) {
  const value = raw & 255;
  setFlags(state, diff, {
    z: value === 0,
    c: carry,
    n: (value & 128) !== 0,
  });
}

function setFlags(state, diff, nextFlags) {
  Object.entries(nextFlags).forEach(([name, after]) => {
    const before = state.flags[name];
    state.flags[name] = after;
    if (before !== after) diff.flags.push({ name, before, after });
  });
}

function resolveTarget(program, token) {
  if (isNumber(token)) return parseNumber(token);
  return program.labels.get(token);
}

function isNumber(token) {
  return /^-?\d+$/.test(token) || /^0x[0-9a-f]+$/i.test(token);
}

function parseNumber(token) {
  return Number.parseInt(token, token.toLowerCase().startsWith("0x") ? 16 : 10);
}

function createTinyCParser(source) {
  return {
    source: extractTinyMain(stripTinyCComments(source)),
    index: 0,
    labelId: 0,
    symbols: new Map(),
    nextRegister: 0,
  };
}

function stripTinyCComments(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*/, ""))
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

function extractTinyMain(source) {
  const match = /\b(?:int|void)\s+main\s*\([^)]*\)\s*\{/.exec(source);
  if (!match) return source;

  const bodyStart = match.index + match[0].length;
  let index = bodyStart;
  let depth = 1;
  while (index < source.length && depth > 0) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    index += 1;
  }
  if (depth !== 0) throw new Error("Expected \"}\" to close main().");
  return source.slice(bodyStart, index - 1);
}

function compileTinyBlock(parser, stopAtBrace) {
  const lines = [];

  while (true) {
    skipTinyWhitespace(parser);
    if (parser.index >= parser.source.length) {
      if (stopAtBrace) throw new Error("Expected \"}\" to close block.");
      return lines;
    }

    if (parser.source[parser.index] === "}") {
      if (!stopAtBrace) throw new Error(`Line ${tinyLine(parser)}: unexpected "}".`);
      parser.index += 1;
      return lines;
    }

    if (matchTinyKeyword(parser, "while")) {
      lines.push(...compileTinyWhile(parser));
      continue;
    }

    if (matchTinyKeyword(parser, "for")) {
      lines.push(...compileTinyFor(parser));
      continue;
    }

    if (matchTinyKeyword(parser, "if")) {
      lines.push(...compileTinyIf(parser));
      continue;
    }

    const statementLine = tinyLine(parser);
    const statement = readTinyStatement(parser);
    if (!statement) continue;
    lines.push(...compileTinyStatement(parser, statement, statementLine));
  }
}

function compileTinyWhile(parser) {
  const line = tinyLine(parser);
  parser.index += "while".length;
  const condition = readTinyCondition(parser, line);
  const startLabel = nextTinyLabel(parser, "while");
  const endLabel = nextTinyLabel(parser, "endwhile");

  expectTinyChar(parser, "{", line);
  const body = compileTinyBlock(parser, true);

  return [
    `${startLabel}:`,
    `CMP ${condition.left}, ${condition.right}`,
    `${condition.falseJump} ${endLabel}`,
    ...body,
    `JMP ${startLabel}`,
    `${endLabel}:`,
  ];
}

function compileTinyFor(parser) {
  const line = tinyLine(parser);
  parser.index += "for".length;
  const parts = readTinyForParts(parser, line);
  const startLabel = nextTinyLabel(parser, "for");
  const endLabel = nextTinyLabel(parser, "endfor");

  const init = parts.init ? compileTinyStatement(parser, parts.init, line) : [];
  const condition = parts.condition ? parseTinyCondition(parts.condition, parser, line) : null;
  const update = parts.update ? compileTinyStatement(parser, parts.update, line) : [];

  expectTinyChar(parser, "{", line);
  const body = compileTinyBlock(parser, true);

  return [
    ...init,
    `${startLabel}:`,
    ...(condition ? [`CMP ${condition.left}, ${condition.right}`, `${condition.falseJump} ${endLabel}`] : []),
    ...body,
    ...update,
    `JMP ${startLabel}`,
    `${endLabel}:`,
  ];
}

function compileTinyIf(parser) {
  const line = tinyLine(parser);
  parser.index += "if".length;
  const condition = readTinyCondition(parser, line);
  const endLabel = nextTinyLabel(parser, "endif");
  const elseLabel = nextTinyLabel(parser, "else");

  expectTinyChar(parser, "{", line);
  const body = compileTinyBlock(parser, true);

  skipTinyWhitespace(parser);
  if (matchTinyKeyword(parser, "else")) {
    parser.index += "else".length;
    expectTinyChar(parser, "{", line);
    const elseBody = compileTinyBlock(parser, true);
    return [
      `CMP ${condition.left}, ${condition.right}`,
      `${condition.falseJump} ${elseLabel}`,
      ...body,
      `JMP ${endLabel}`,
      `${elseLabel}:`,
      ...elseBody,
      `${endLabel}:`,
    ];
  }

  return [
    `CMP ${condition.left}, ${condition.right}`,
    `${condition.falseJump} ${endLabel}`,
    ...body,
    `${endLabel}:`,
  ];
}

function readTinyCondition(parser, line) {
  skipTinyWhitespace(parser);
  expectTinyChar(parser, "(", line);

  const start = parser.index;
  let depth = 1;
  while (parser.index < parser.source.length && depth > 0) {
    const char = parser.source[parser.index];
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth > 0) parser.index += 1;
  }

  if (depth !== 0) throw new Error(`Line ${line}: expected ")" to close condition.`);

  const condition = parser.source.slice(start, parser.index).trim();
  parser.index += 1;

  return parseTinyCondition(condition, parser, line);
}

function parseTinyCondition(condition, parser, line) {
  let match = /^(.+?)\s*==\s*(.+)$/.exec(condition);
  if (match) {
    return {
      left: valueToken(match[1], parser),
      right: valueToken(match[2], parser),
      falseJump: "JNZ",
    };
  }

  match = /^(.+?)\s*!=\s*(.+)$/.exec(condition);
  if (match) {
    return {
      left: valueToken(match[1], parser),
      right: valueToken(match[2], parser),
      falseJump: "JZ",
    };
  }

  match = /^(.+?)\s*<=\s*(.+)$/.exec(condition);
  if (match) {
    return {
      left: valueToken(match[1], parser),
      right: valueToken(match[2], parser),
      falseJump: "JGT",
    };
  }

  match = /^(.+?)\s*>=\s*(.+)$/.exec(condition);
  if (match) {
    return {
      left: valueToken(match[1], parser),
      right: valueToken(match[2], parser),
      falseJump: "JLT",
    };
  }

  match = /^(.+?)\s*<\s*(.+)$/.exec(condition);
  if (match) {
    return {
      left: valueToken(match[1], parser),
      right: valueToken(match[2], parser),
      falseJump: "JGE",
    };
  }

  match = /^(.+?)\s*>\s*(.+)$/.exec(condition);
  if (match) {
    return {
      left: valueToken(match[1], parser),
      right: valueToken(match[2], parser),
      falseJump: "JLE",
    };
  }

  throw new Error(`Line ${line}: expected condition like i < 8 or r0 == 4.`);
}

function readTinyForParts(parser, line) {
  skipTinyWhitespace(parser);
  expectTinyChar(parser, "(", line);
  const start = parser.index;
  let depth = 1;
  while (parser.index < parser.source.length && depth > 0) {
    const char = parser.source[parser.index];
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth > 0) parser.index += 1;
  }
  if (depth !== 0) throw new Error(`Line ${line}: expected ")" to close for loop.`);
  const raw = parser.source.slice(start, parser.index);
  parser.index += 1;
  const parts = splitTinyForParts(raw);
  if (parts.length !== 3) throw new Error(`Line ${line}: expected for (init; condition; update).`);
  return {
    init: parts[0].trim(),
    condition: parts[1].trim(),
    update: parts[2].trim(),
  };
}

function splitTinyForParts(raw) {
  const parts = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth -= 1;
    if (char === ";" && depth === 0) {
      parts.push(raw.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(raw.slice(start));
  return parts;
}

function readTinyStatement(parser) {
  const start = parser.index;
  let depth = 0;

  while (parser.index < parser.source.length) {
    const char = parser.source[parser.index];
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth -= 1;
    if (depth === 0 && (char === ";" || char === "\n" || char === "}")) break;
    parser.index += 1;
  }

  const statement = parser.source.slice(start, parser.index).trim();
  if (parser.source[parser.index] === ";" || parser.source[parser.index] === "\n") parser.index += 1;
  return statement;
}

function expectTinyChar(parser, char, line) {
  skipTinyWhitespace(parser);
  if (parser.source[parser.index] !== char) throw new Error(`Line ${line}: expected "${char}".`);
  parser.index += 1;
}

function matchTinyKeyword(parser, keyword) {
  const before = parser.index === 0 ? "" : parser.source[parser.index - 1];
  const after = parser.source[parser.index + keyword.length] ?? "";
  return parser.source.slice(parser.index, parser.index + keyword.length).toLowerCase() === keyword
    && !/[A-Za-z0-9_]/.test(before)
    && !/[A-Za-z0-9_]/.test(after);
}

function skipTinyWhitespace(parser) {
  while (/\s/.test(parser.source[parser.index] ?? "")) parser.index += 1;
}

function tinyLine(parser) {
  return parser.source.slice(0, parser.index).split("\n").length;
}

function nextTinyLabel(parser, name) {
  const id = parser.labelId;
  parser.labelId += 1;
  return `__tiny_${name}_${id}`;
}

function compileTinyStatement(parser, statement, line) {
  const text = statement.trim();

  if (/^[A-Za-z_]\w*:$/.test(text)) return [text];
  if (/^halt\(\)$/i.test(text)) return ["HALT"];
  if (/^cls\(\)$/i.test(text)) return ["CLS"];
  if (/^return(?:\s+.+)?$/i.test(text)) return ["HALT"];

  let match = /^int\s+([A-Za-z_]\w*)\s*(?:=\s*(.+))?$/i.exec(text);
  if (match) return compileIntDeclaration(parser, match[1], match[2], line);

  match = /^draw\(([^,]+),([^)]+)\)$/i.exec(text);
  if (match) return [`DRAW ${valueToken(match[1], parser)}, ${valueToken(match[2], parser)}`];

  match = /^cmp\(([^,]+),([^)]+)\)$/i.exec(text);
  if (match) return [`CMP ${valueToken(match[1], parser)}, ${valueToken(match[2], parser)}`];

  match = /^goto\s+([A-Za-z_]\w*)$/i.exec(text);
  if (match) return [`JMP ${match[1]}`];

  match = /^ifz\s+([A-Za-z_]\w*)$/i.exec(text);
  if (match) return [`JZ ${match[1]}`];

  match = /^ifnz\s+([A-Za-z_]\w*)$/i.exec(text);
  if (match) return [`JNZ ${match[1]}`];

  match = /^(?:let\s+)?([A-Za-z_]\w*|r[0-7])\s*=\s*(.+)$/i.exec(text);
  if (match) return compileAssignment(parser, match[1], match[2], line);

  match = /^([A-Za-z_]\w*|r[0-7])\+\+$/i.exec(text);
  if (match) return [`INC ${writableToken(match[1], parser)}`];

  match = /^([A-Za-z_]\w*|r[0-7])--$/i.exec(text);
  if (match) return [`DEC ${writableToken(match[1], parser)}`];

  match = /^mem\[(.+)\]\s*=\s*(.+)$/i.exec(text);
  if (match) return [`STORE [${valueToken(match[1], parser)}], ${valueToken(match[2], parser)}`];

  throw new Error(`Line ${line}: cannot compile "${statement}".`);
}

function compileIntDeclaration(parser, name, initializer, line) {
  if (/^r[0-7]$/i.test(name)) throw new Error(`Line ${line}: "${name}" is a register name, not a variable name.`);
  if (parser.symbols.has(name)) throw new Error(`Line ${line}: variable "${name}" is already declared.`);
  if (parser.nextRegister >= REGISTER_COUNT) throw new Error(`Line ${line}: no free registers left for "${name}".`);

  const register = `R${parser.nextRegister}`;
  parser.nextRegister += 1;
  parser.symbols.set(name, register);

  const lines = [`; int ${name} -> ${register}`];
  if (initializer === undefined) return [...lines, `MOV ${register}, 0`];
  return [...lines, ...compileAssignment(parser, name, initializer, line)];
}

function compileAssignment(parser, register, expression, line) {
  const target = writableToken(register, parser);
  const expr = expression.trim();

  let match = /^mem\[(.+)\]$/i.exec(expr);
  if (match) return [`LOAD ${target}, [${valueToken(match[1], parser)}]`];

  match = /^(.+)\s*\+\s*(.+)$/.exec(expr);
  if (match) {
    const left = valueToken(match[1], parser);
    const right = valueToken(match[2], parser);
    return left.toUpperCase() === target ? [`ADD ${target}, ${right}`] : [`MOV ${target}, ${left}`, `ADD ${target}, ${right}`];
  }

  match = /^(.+)\s*-\s*(.+)$/.exec(expr);
  if (match) {
    const left = valueToken(match[1], parser);
    const right = valueToken(match[2], parser);
    return left.toUpperCase() === target ? [`SUB ${target}, ${right}`] : [`MOV ${target}, ${left}`, `SUB ${target}, ${right}`];
  }

  if (/^[A-Za-z_]\w*$/.test(expr) || /^r[0-7]$/i.test(expr) || isNumber(expr)) return [`MOV ${target}, ${valueToken(expr, parser)}`];

  throw new Error(`Line ${line}: unsupported expression "${expression}".`);
}

function valueToken(token, parser) {
  const trimmed = token.trim();
  if (/^r[0-7]$/i.test(trimmed)) return registerToken(trimmed);
  if (isNumber(trimmed)) return trimmed;
  if (/^[A-Za-z_]\w*$/.test(trimmed) && parser.symbols.has(trimmed)) return parser.symbols.get(trimmed);
  throw new Error(`Expected register or number, got "${token}".`);
}

function writableToken(token, parser) {
  const trimmed = token.trim();
  if (/^r[0-7]$/i.test(trimmed)) return registerToken(trimmed);
  if (/^[A-Za-z_]\w*$/.test(trimmed) && parser.symbols.has(trimmed)) return parser.symbols.get(trimmed);
  throw new Error(`Expected register or declared int variable, got "${token}".`);
}

function registerToken(token) {
  return token.trim().toUpperCase();
}
