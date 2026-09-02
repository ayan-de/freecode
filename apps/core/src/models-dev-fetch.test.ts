import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as http from "http";

// This feed now drives three things — the model picker, provider identity
// (providers/catalogue.ts) and pricing — so how it behaves when models.dev is
// slow, flaky, or unreachable is no longer a cosmetic concern. `https.get` has
// no default timeout, so before this a stalled socket hung all three forever
// with no error to fall back from.
//
// Served over plain http on loopback via FREECODE_MODELS_URL. That override
// exists for internal mirrors and air-gapped installs; these tests are just
// its first consumer.

async function withServer(
  handler: http.RequestListener,
  run: (url: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  try {
    await run(`http://127.0.0.1:${port}/api.json`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

function freshEnv(t: { after: (fn: () => void) => void }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-modelsdev-"));
  const cacheFile = path.join(dir, "models-dev.json");
  const prevUrl = process.env.FREECODE_MODELS_URL;
  const prevCache = process.env.FREECODE_MODELS_CACHE_FILE;
  const prevTimeout = process.env.FREECODE_MODELS_TIMEOUT_MS;
  process.env.FREECODE_MODELS_CACHE_FILE = cacheFile;
  // The real ceiling is 10s x 3 attempts; these assert the shape of the
  // behaviour, not the duration, so shorten it rather than spend 30s proving
  // a timeout fires.
  process.env.FREECODE_MODELS_TIMEOUT_MS = "300";
  t.after(() => {
    if (prevUrl === undefined) delete process.env.FREECODE_MODELS_URL;
    else process.env.FREECODE_MODELS_URL = prevUrl;
    if (prevCache === undefined) delete process.env.FREECODE_MODELS_CACHE_FILE;
    else process.env.FREECODE_MODELS_CACHE_FILE = prevCache;
    if (prevTimeout === undefined) delete process.env.FREECODE_MODELS_TIMEOUT_MS;
    else process.env.FREECODE_MODELS_TIMEOUT_MS = prevTimeout;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return cacheFile;
}

const BODY = JSON.stringify({
  acme: {
    name: "Acme",
    npm: "@ai-sdk/openai-compatible",
    api: "https://acme.invalid/v1",
    env: ["ACME_API_KEY"],
    models: { "acme-1": { name: "Acme One", cost: { input: 1, output: 2 } } },
  },
});

test("a transient failure is retried rather than surfaced", async (t) => {
  freshEnv(t);
  let hits = 0;
  await withServer(
    (_req, res) => {
      hits++;
      // Fail twice, succeed on the third: one bad second from models.dev must
      // not push every caller onto the stale-cache path.
      if (hits < 3) {
        res.statusCode = 503;
        res.end("nope");
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(BODY);
    },
    async (url) => {
      process.env.FREECODE_MODELS_URL = url;
      const { getProviders } = await import("./models-dev.js");
      const providers = await getProviders(true);
      assert.equal(hits, 3, "expected two retries before success");
      assert.equal(providers.find((p) => p.id === "acme")?.name, "Acme");
    },
  );
});

test("a non-2xx response is an error, not a catalogue of nothing", async (t) => {
  freshEnv(t);
  await withServer(
    (_req, res) => {
      res.statusCode = 500;
      res.end("<html>error</html>");
    },
    async (url) => {
      process.env.FREECODE_MODELS_URL = url;
      const { getProviders } = await import("./models-dev.js");
      // The failure this guards: an HTML error page parsed as JSON used to
      // either throw something unrecognisable or, worse, resolve to an empty
      // provider list that reads as "models.dev knows of no providers".
      await assert.rejects(() => getProviders(true), /500/);
    },
  );
});

test("a hung connection gives up instead of waiting forever", async (t) => {
  freshEnv(t);
  await withServer(
    (_req, res) => {
      // Headers, then silence — the shape `https.get` has no defence against.
      res.setHeader("content-type", "application/json");
      res.write("{");
    },
    async (url) => {
      process.env.FREECODE_MODELS_URL = url;
      const { getProviders } = await import("./models-dev.js");
      const started = Date.now();
      await assert.rejects(() => getProviders(true), /timed out|aborted|socket/i);
      // Asserting an upper bound only: the point is that it terminates at all.
      assert.ok(
        Date.now() - started < 10_000,
        "expected the fetch to give up, not hang",
      );
    },
  );
});
