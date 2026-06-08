import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_MAX_BODY_BYTES = 128 * 1024;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};
const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(SERVER_DIR);
const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, JSON_HEADERS);
  response.end(JSON.stringify(payload));
}

async function sendStatic(response, pathname) {
  const normalizedPath = normalize(decodeURIComponent(pathname));
  const relativePath = normalizedPath === "/" ? "index.html" : normalizedPath.replace(/^\/+/, "");
  const filePath = join(PROJECT_ROOT, relativePath);

  if (!filePath.startsWith(PROJECT_ROOT)) {
    sendJson(response, 403, { ok: false, assembly: "", diagnostics: "Forbidden" });
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");
    const contentType = STATIC_TYPES[extname(filePath)] ?? "application/octet-stream";
    response.writeHead(200, { "content-type": contentType });
    response.end(await readFile(filePath));
  } catch {
    sendJson(response, 404, { ok: false, assembly: "", diagnostics: "Not found" });
  }
}

function readJsonBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > maxBytes) {
        reject(Object.assign(new Error("Request body is too large"), { statusCode: 413 }));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON"), { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function runClang(args, { timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn("clang", args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${error.message}\n`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

export async function compileCToAssembly(source, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const dir = await mkdtemp(join(tmpdir(), "underlow-c-"));
  const inputPath = join(dir, "input.c");
  const outputPath = join(dir, "output.s");

  try {
    await writeFile(inputPath, source, "utf8");
    const result = await runClang([
      "-S",
      "-O0",
      "-fno-color-diagnostics",
      "-Wall",
      "-Wextra",
      "-x",
      "c",
      inputPath,
      "-o",
      outputPath,
    ], { timeoutMs });

    const diagnostics = result.timedOut
      ? `${result.stderr}Compilation timed out after ${timeoutMs}ms.\n`
      : `${result.stdout}${result.stderr}`;

    if (result.timedOut || result.code !== 0) {
      return { ok: false, assembly: "", diagnostics };
    }

    return {
      ok: true,
      assembly: await readFile(outputPath, "utf8"),
      diagnostics,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function createServer(options = {}) {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "OPTIONS") {
      response.writeHead(204, JSON_HEADERS);
      response.end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true, service: "underlow-backend" });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/compile/c") {
      try {
        const body = await readJsonBody(request, maxBodyBytes);
        const code = typeof body.code === "string" ? body.code : body.source;
        if (typeof code !== "string") {
          sendJson(response, 400, { ok: false, assembly: "", diagnostics: "Expected JSON body with string field: code" });
          return;
        }

        const result = await compileCToAssembly(code, { timeoutMs });
        sendJson(response, 200, result);
      } catch (error) {
        const statusCode = error.statusCode ?? 500;
        sendJson(response, statusCode, {
          ok: false,
          assembly: "",
          diagnostics: error.message ?? "Internal server error",
        });
      }
      return;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      await sendStatic(response, url.pathname);
      return;
    }

    sendJson(response, 404, { ok: false, assembly: "", diagnostics: "Not found" });
  });
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const port = Number.parseInt(process.env.PORT ?? "8121", 10);
  const host = process.env.HOST ?? "127.0.0.1";
  createServer().listen(port, host, () => {
    console.log(`Underlow backend listening at http://${host}:${port}`);
  });
}
