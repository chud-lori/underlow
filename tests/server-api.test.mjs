import assert from "node:assert/strict";
import { request } from "node:http";
import { createServer } from "../server/index.js";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function jsonRequest(address, method, path, body) {
  const payload = body === undefined ? undefined : JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const req = request({
      host: address.address,
      port: address.port,
      method,
      path,
      headers: payload
        ? {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
          }
        : undefined,
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          resolve({ statusCode: res.statusCode, body: data ? JSON.parse(data) : null });
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const server = createServer({ timeoutMs: 2000 });
const address = await listen(server);

try {
  {
    const response = await jsonRequest(address, "GET", "/api/health");
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { ok: true, service: "underlow-backend" });
  }

  {
    const response = await jsonRequest(address, "OPTIONS", "/api/compile/c");
    assert.equal(response.statusCode, 204);
  }

  {
    const response = await jsonRequest(address, "POST", "/api/compile/c", {
      code: "int add(int a, int b) { return a + b; }\n",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.match(response.body.assembly, /add:/);
    assert.equal(typeof response.body.diagnostics, "string");
  }

  {
    const response = await jsonRequest(address, "POST", "/api/compile/c", {
      source: "int main(void) { return 0; }\n",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.match(response.body.assembly, /main:/);
  }

  {
    const response = await jsonRequest(address, "POST", "/api/compile/c", {
      code: "int main( { return 0; }\n",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.assembly, "");
    assert.match(response.body.diagnostics, /error:/);
  }

  {
    const response = await jsonRequest(address, "POST", "/api/compile/c", {});
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.ok, false);
    assert.match(response.body.diagnostics, /code/);
  }

  {
    const response = await jsonRequest(address, "GET", "/api/compile/c");
    assert.equal(response.statusCode, 404);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.diagnostics, "Not found");
  }
} finally {
  await close(server);
}

console.log("server api checks passed");
