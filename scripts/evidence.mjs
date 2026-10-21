import { startStack, names } from "./stack.mjs";
import { scenarios, emit } from "./scenarios.mjs";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";

const index = process.argv.indexOf("--scenario");
const selected = index >= 0 ? process.argv[index + 1] : "all";
if (selected !== "all" && !Object.hasOwn(scenarios, selected)) {
  throw new Error("Unknown scenario: " + selected);
}
const stack = await startStack({
  tag: "evidence",
  basePort: 18081,
  pgPort: 15433,
});
const original = console.log;
let output = "";
console.log = (...args) => {
  const line = args.join(" ");
  output += line + "\n";
  original(...args);
};
const folders = {
  health: "tests",
  main: "tests",
  contracts: "tests",
  concurrency: "challenge-1-concurrency",
  idempotency: "challenge-2-idempotency",
  resilience: "challenge-3a-resilience",
  recovery: "challenge-3a-resilience",
};
let passed = 0;
try {
  for (const [name, fn] of Object.entries(scenarios)) {
    if (selected !== "all" && selected !== name) continue;
    output = "";
    emit("RUN " + name, {
      command: "node scripts/evidence.mjs --scenario " + name,
      started: new Date().toISOString(),
    });
    await fn(stack);
    passed++;
    emit("RESULT PASS " + name);
    const folder = resolve("evidence", folders[name]);
    await mkdir(folder, { recursive: true });
    await writeFile(resolve(folder, name + ".jsonl"), output);
  }
  const logdir = resolve("evidence", "service-logs");
  await mkdir(logdir, { recursive: true });
  for (const name of names) {
    await copyFile(
      resolve(stack.runtime, name + ".jsonl"),
      resolve(logdir, name + ".jsonl"),
    );
  }
  emit("SUITE PASSED", { scenarios: passed });
} catch (err) {
  emit("RESULT FAIL", { message: err.message, stack: err.stack });
  process.exitCode = 1;
} finally {
  await stack.close();
}
