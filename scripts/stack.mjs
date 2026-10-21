import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { existsSync, createWriteStream } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
export const names = ["booking", "inventory", "payment", "notification"];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitHealth(url, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (
        (await fetch(url + "/health", { signal: AbortSignal.timeout(800) })).ok
      )
        return;
    } catch {}
    await sleep(100);
  }
  throw new Error("Not healthy: " + url);
}
export async function startStack({
  tag = "dev",
  basePort = 8081,
  pgPort = 15432,
} = {}) {
  const runtime = resolve(".runtime", tag);
  await mkdir(runtime, { recursive: true });
  const configFile = resolve(runtime, "config.json");
  let config;
  if (existsSync(configFile)) config = JSON.parse(await readFile(configFile));
  else {
    config = {
      adminPassword: randomBytes(20).toString("hex"),
      roles: Object.fromEntries(
        names.map((n) => [n, randomBytes(20).toString("hex")]),
      ),
    };
    await writeFile(configFile, JSON.stringify(config, null, 2));
  }
  const postgres = new EmbeddedPostgres({
    databaseDir: resolve(runtime, "pgdata"),
    user: "postgres",
    password: config.adminPassword,
    port: pgPort,
    persistent: true,
    authMethod: "scram-sha-256",
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-h", "127.0.0.1"],
    onLog: () => {},
    onError: (msg) =>
      appendFile(resolve(runtime, "postgres.log"), String(msg) + "\n").catch(
        () => {},
      ),
  });
  if (!existsSync(resolve(runtime, "pgdata", "PG_VERSION")))
    await postgres.initialise();
  await postgres.start();
  const admin = postgres.getPgClient("postgres", "127.0.0.1");
  await admin.connect();
  const urls = Object.fromEntries(
    names.map((n, i) => [n, "http://127.0.0.1:" + (basePort + i)]),
  );
  const dbs = {};
  for (const n of names) {
    const role = "sf_" + n;
    const db = "sf_" + n;
    if (
      !(await admin.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]))
        .rowCount
    )
      await admin.query(
        "CREATE ROLE " + role + " LOGIN PASSWORD '" + config.roles[n] + "'",
      );
    if (
      !(await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [db]))
        .rowCount
    )
      await admin.query("CREATE DATABASE " + db + " OWNER " + role);
    await admin.query("REVOKE ALL ON DATABASE " + db + " FROM PUBLIC");
    await admin.query("GRANT CONNECT ON DATABASE " + db + " TO " + role);
    dbs[n] =
      "postgresql://" +
      role +
      ":" +
      config.roles[n] +
      "@127.0.0.1:" +
      pgPort +
      "/" +
      db;
  }
  await admin.end();
  const state = { urls, dbs, runtime };
  await writeFile(
    resolve(runtime, "connection.json"),
    JSON.stringify(state, null, 2),
  );
  const children = {};
  const logs = {};
  let stopping = false;
  async function start(n) {
    const env = {
      ...process.env,
      DATABASE_URL: dbs[n],
      PORT: String(basePort + names.indexOf(n)),
      HOST: "127.0.0.1",
      INVENTORY_URL: urls.inventory,
      PAYMENT_URL: urls.payment,
      NOTIFICATION_URL: urls.notification,
      ENABLE_SIMULATION: "true",
      HTTP_TIMEOUT_MS: "300",
      RETRY_ATTEMPTS: "3",
      RETRY_BASE_MS: "80",
      WORKER_INTERVAL_MS: "100",
      MOCK_DELAY_MS: "1200",
    };
    await writeFile(
      resolve(runtime, n + ".env"),
      Object.entries(env)
        .filter(([k]) =>
          [
            "DATABASE_URL",
            "PORT",
            "HOST",
            "INVENTORY_URL",
            "PAYMENT_URL",
            "NOTIFICATION_URL",
            "ENABLE_SIMULATION",
            "HTTP_TIMEOUT_MS",
            "RETRY_ATTEMPTS",
            "RETRY_BASE_MS",
            "WORKER_INTERVAL_MS",
            "MOCK_DELAY_MS",
          ].includes(k),
        )
        .map(([k, v]) => k + "=" + v)
        .join("\n"),
    );
    const stream = createWriteStream(resolve(runtime, n + ".jsonl"), {
      flags: "a",
    });
    logs[n] = stream;
    const child = spawn(process.execPath, ["services/" + n + "/src/main.mjs"], {
      cwd: process.cwd(),
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    children[n] = child;
    child.stdout.pipe(stream, { end: false });
    child.stderr.pipe(stream, { end: false });
    child.on("error", (err) => console.error(n, err));
    await waitHealth(urls[n]);
  }
  async function stop(n) {
    const c = children[n];
    if (!c) return;
    await new Promise((r) => {
      c.once("exit", r);
      c.kill();
    });
    delete children[n];
    logs[n]?.end();
  }
  async function close() {
    if (stopping) return;
    stopping = true;
    for (const n of names) await stop(n);
    if (process.platform === "win32") {
      const { postgres: binary } = await import(
        "@embedded-postgres/windows-x64"
      );
      await new Promise((resolveStop, reject) => {
        const ctl = spawn(
          join(dirname(binary), "pg_ctl.exe"),
          ["-D", resolve(runtime, "pgdata"), "-m", "fast", "-w", "stop"],
          { windowsHide: true, stdio: "ignore" },
        );
        ctl.on("error", reject);
        ctl.on("exit", (code) =>
          code === 0
            ? resolveStop()
            : reject(new Error("pg_ctl stop failed " + code)),
        );
      });
    } else await postgres.stop();
  }
  try {
    for (const n of names) await start(n);
  } catch (err) {
    await close();
    throw err;
  }
  return { ...state, start, stop, close };
}
export async function query(stack, service, sql, values = []) {
  const c = new pg.Client({ connectionString: stack.dbs[service] });
  await c.connect();
  try {
    return (await c.query(sql, values)).rows;
  } finally {
    await c.end();
  }
}
