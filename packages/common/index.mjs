import express from "express";
import pg from "pg";
import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
export { z } from "zod";
export const context = new AsyncLocalStorage();
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export class Fault extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function log(event, data = {}) {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      service: process.env.SERVICE_NAME,
      correlationId: context.getStore()?.id ?? "background",
      event,
      ...data,
    }),
  );
}
export function pool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  return new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DB_POOL_SIZE ?? 12),
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
  });
}
export async function transaction(db, fn) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
export const fingerprint = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
export const idempotencySchema = `CREATE TABLE IF NOT EXISTS idempotency (
  key text PRIMARY KEY, fingerprint text NOT NULL, status integer, response jsonb,
  created_at timestamptz NOT NULL DEFAULT now());`;
// The key claim and the business effect commit together. PostgreSQL's unique index
// waits for a competing transaction; the subsequent SELECT sees its committed result.
export async function idempotent(db, key, payload, effect) {
  if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(key))
    throw new Fault(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "Supply a 1 to 128 character Idempotency-Key",
    );
  return transaction(db, async (client) => {
    const hash = fingerprint(payload);
    const claim = await client.query(
      "INSERT INTO idempotency(key,fingerprint) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING key",
      [key, hash],
    );
    if (!claim.rowCount) {
      const {
        rows: [existing],
      } = await client.query("SELECT * FROM idempotency WHERE key=$1", [key]);
      if (existing.fingerprint !== hash)
        throw new Fault(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Key was already used with a different request",
        );
      log("idempotency_replay", { key });
      return { status: existing.status, body: existing.response, replay: true };
    }
    await client.query("SAVEPOINT business_effect");
    let result;
    try {
      result = await effect(client);
    } catch (err) {
      if (!(err instanceof Fault) || err.status >= 500) throw err;
      await client.query("ROLLBACK TO SAVEPOINT business_effect");
      result = {
        status: err.status,
        body: {
          error: {
            code: err.code,
            message: err.message,
            correlationId: context.getStore()?.id ?? "unknown",
          },
        },
      };
    }
    await client.query(
      "UPDATE idempotency SET status=$2,response=$3 WHERE key=$1",
      [key, result.status, result.body],
    );
    return result;
  });
}
export function send(res, result) {
  if (result.replay) res.set("Idempotency-Replayed", "true");
  return res.status(result.status).json(result.body);
}
export function appFor(name, db, spec) {
  process.env.SERVICE_NAME = name;
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const incoming = req.get("X-Correlation-ID");
    const id =
      incoming && /^[A-Za-z0-9._:-]{1,100}$/.test(incoming)
        ? incoming
        : randomUUID();
    context.run({ id }, () => {
      res.set("X-Correlation-ID", id);
      const started = Date.now();
      res.on("finish", () =>
        log("http_request", {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - started,
        }),
      );
      next();
    });
  });
  app.use(express.json({ limit: "32kb" }));
  app.get("/health", async (_req, res) => {
    await db.query("SELECT 1");
    res.json({ service: name, status: "ok" });
  });
  app.get("/openapi.json", (_req, res) => res.json(spec));
  return app;
}
export function finish(app) {
  app.use((_req, _res, next) =>
    next(new Fault(404, "NOT_FOUND", "Endpoint not found")),
  );
  app.use((err, _req, res, _next) => {
    const invalid =
      err.name === "ZodError" || err.type === "entity.parse.failed";
    const status = invalid ? 422 : (err.status ?? 500);
    if (status >= 500)
      log("error", {
        code: err.code ?? "INTERNAL_ERROR",
        message: err.message,
      });
    res
      .status(status)
      .json({
        error: {
          code: invalid ? "VALIDATION_ERROR" : (err.code ?? "INTERNAL_ERROR"),
          message: invalid
            ? "Request fields or JSON are invalid"
            : status === 500
              ? "An internal error occurred"
              : err.message,
          correlationId: context.getStore()?.id ?? "unknown",
        },
      });
  });
}
export function listen(app, db, stop = () => {}) {
  const server = app.listen(
    Number(process.env.PORT),
    process.env.HOST ?? "127.0.0.1",
    () => log("listening", { port: Number(process.env.PORT) }),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      stop();
      server.close();
      await db.end();
      process.exit(0);
    });
  return server;
}
// Only idempotent downstream operations are retried. Business rejections are final.
export async function remote(
  url,
  {
    method = "GET",
    body,
    key,
    attempts = Number(process.env.RETRY_ATTEMPTS ?? 3),
    timeout = Number(process.env.HTTP_TIMEOUT_MS ?? 300),
    base = Number(process.env.RETRY_BASE_MS ?? 80),
    rng = Math.random,
    wait = sleep,
    transport = fetch,
  } = {},
) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await transport(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Correlation-ID": context.getStore()?.id ?? randomUUID(),
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeout),
      });
      const data = await response.json();
      if (response.status < 500) return { status: response.status, body: data };
      last = new Fault(
        503,
        "DEPENDENCY_UNAVAILABLE",
        `Downstream returned ${response.status}`,
      );
    } catch (err) {
      last = new Fault(
        503,
        "DEPENDENCY_UNAVAILABLE",
        `Downstream timeout or connection failure: ${err.name}`,
      );
    }
    if (attempt + 1 < attempts) {
      const delayMs = Math.floor(base * 2 ** attempt + rng() * base);
      log("downstream_retry", { attempt: attempt + 1, delayMs, url });
      await wait(delayMs);
    }
  }
  throw last;
}
