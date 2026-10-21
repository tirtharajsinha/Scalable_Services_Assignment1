import { startStack } from "./stack.mjs";
const stack = await startStack();
console.log(
  "SeatFlow ready. Four independent Node processes and four PostgreSQL databases.",
);
for (const [n, url] of Object.entries(stack.urls))
  console.log(n + ": " + url + "/health");
console.log(
  "Service environment files: .runtime/dev/<service>.env (do not publish). Ctrl+C stops the stack; data persists.",
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await stack.close();
    process.exit(0);
  });
