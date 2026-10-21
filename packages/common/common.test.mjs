import test from "node:test";
import assert from "node:assert/strict";
import { fingerprint, remote } from "./index.mjs";
test("BR2 fingerprint ignores key order but detects changed payload", () => {
  assert.equal(fingerprint({ a: 1, b: 2 }), fingerprint({ b: 2, a: 1 }));
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
});
test("Retry backoff increases and includes bounded jitter", async () => {
  const delays = [];
  let calls = 0;
  const r = await remote("http://example.test", {
    attempts: 3,
    base: 80,
    rng: () => 0.5,
    wait: async (n) => delays.push(n),
    transport: async () => {
      calls++;
      return {
        status: calls === 3 ? 201 : 503,
        json: async () => ({ ok: true }),
      };
    },
  });
  assert.equal(r.status, 201);
  assert.deepEqual(delays, [120, 200]);
});
test("Business rejection is not retried", async () => {
  let calls = 0;
  const r = await remote("http://example.test", {
    transport: async () => {
      calls++;
      return {
        status: 402,
        json: async () => ({ error: { code: "PAYMENT_DECLINED" } }),
      };
    },
  });
  assert.equal(r.status, 402);
  assert.equal(calls, 1);
});
test("Exhausted retries produce a bounded dependency error", async () => {
  let calls = 0;
  await assert.rejects(
    remote("http://example.test", {
      attempts: 3,
      wait: async () => {},
      transport: async () => {
        calls++;
        throw new Error("offline");
      },
    }),
    { code: "DEPENDENCY_UNAVAILABLE" },
  );
  assert.equal(calls, 3);
});
