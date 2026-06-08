# Underlow

Underlow is an interactive low-level programming playground for people who know basic programming but want to understand registers, memory, flags, control flow, and pixels.

The app includes a local backend for the C Playground compiler API.

## MVP Shape

- Fictional 8-bit teaching CPU
- Assembly editor
- C-like code mode that compiles into assembly
- Step, run, pause, and reset controls
- Register and flag visualization
- Memory grid with read/write highlights
- 32x24 pixel display
- Game-style missions with score and validation checks
- Free play mode for experimenting

## Code Modes

Assembly example:

```asm
MOV R0, 10
MOV R1, 5
DRAW R0, R1
HALT
```

C mode example:

```c
int main() {
  int i;
  int row = 5;

  for (i = 0; i < 8; i++) {
    draw(i, row);
  }

  return 0;
}
```

C mode accepts beginner-shaped C such as `int main()`, `int` variables, `if/else`, `while`, `for`, comparisons, and `return 0`. It is a friendly bridge into low-level thinking, not a full C compiler yet.

## Run Locally

```bash
npm run server
```

Then open:

```text
http://127.0.0.1:8121/
```

Local runs require Go and `clang` on your machine. Docker installs `clang` inside the image.

## Run With Docker

Build and run:

```bash
docker build -t underlow .
docker run --rm -p 8121:8121 underlow
```

Then open:

```text
http://127.0.0.1:8121/
```

Or with Compose:

```bash
docker compose up --build
```

The image installs `clang` so the C Playground can compile C to assembly inside the container.

## Test

```bash
npm test
```

## Roadmap

The active build TODO is tracked in the Codex task plan for this project.
