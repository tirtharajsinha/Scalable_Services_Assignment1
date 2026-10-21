import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { query, sleep, waitHealth, names } from "./stack.mjs";
export const emit = (claim, data) =>
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      claim,
      ...(data !== undefined ? { data } : {}),
    }),
  );
export async function call(
  stack,
  service,
  path,
  {
    method = "GET",
    body,
    key,
    correlationId = "evidence-" + randomUUID(),
  } = {},
) {
  const r = await fetch(stack.urls[service] + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Correlation-ID": correlationId,
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  return {
    status: r.status,
    body: await r.json(),
    replay: r.headers.get("Idempotency-Replayed"),
  };
}
async function workshop(stack, label, capacity = 1) {
  const id = label + "-" + randomUUID().slice(0, 8);
  const r = await call(stack, "inventory", "/api/v1/workshops", {
    method: "POST",
    key: "create:" + id,
    body: { id, title: label + " demonstration", capacity, priceCents: 25000 },
  });
  assert.equal(r.status, 201);
  return id;
}
async function book(stack, id, key = "book:" + randomUUID()) {
  const r = await call(stack, "booking", "/api/v1/bookings", {
    method: "POST",
    key,
    body: { workshopId: id, customer: "Demo learner" },
  });
  assert.equal(r.status, 202);
  return r;
}
async function poll(stack, id, state = "CONFIRMED", timeout = 15000) {
  const end = Date.now() + timeout;
  let b;
  while (Date.now() < end) {
    b = (await call(stack, "booking", "/api/v1/bookings/" + id)).body;
    if (b.state === state) return b;
    await sleep(100);
  }
  throw new Error("Expected " + state + "; got " + JSON.stringify(b));
}
async function notice(stack, id) {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    const r = await call(stack, "notification", "/api/v1/notifications/" + id);
    if (r.status === 200) return r.body;
    await sleep(100);
  }
  throw new Error("Outbox was not delivered");
}
async function mode(stack, value) {
  assert.equal(
    (
      await call(stack, "payment", "/api/v1/simulation", {
        method: "POST",
        body: { mode: value },
      })
    ).status,
    200,
  );
}
async function counts(stack, id) {
  return {
    booking: await query(
      stack,
      "booking",
      "SELECT id,state,payment_id FROM bookings WHERE id=$1",
      [id],
    ),
    payments: await query(
      stack,
      "payment",
      "SELECT id,booking_id,state,amount_cents FROM payments WHERE booking_id=$1",
      [id],
    ),
    reservation: await query(
      stack,
      "inventory",
      "SELECT * FROM reservations WHERE booking_id=$1",
      [id],
    ),
    notifications: await query(
      stack,
      "notification",
      "SELECT id,booking_id,message FROM notifications WHERE booking_id=$1",
      [id],
    ),
  };
}
export async function health(stack) {
  emit("COMMAND GET /health on four independently running services");
  for (const n of names) {
    const r = await call(stack, n, "/health");
    assert.equal(r.status, 200);
    emit(n, r);
  }
  emit("PASS all four own databases are reachable");
}
export async function main(stack) {
  emit("COMMAND POST /api/v1/bookings then GET status until CONFIRMED");
  await mode(stack, "normal");
  const id = await workshop(stack, "main");
  const accepted = await book(stack, id);
  emit("HTTP 202 accepted", accepted);
  const b = await poll(stack, accepted.body.id);
  await notice(stack, b.id);
  emit("GET booking final state", b);
  const c = await counts(stack, b.id);
  assert.equal(c.payments.length, 1);
  assert.equal(c.notifications.length, 1);
  assert.equal(c.reservation[0].state, "CONFIRMED");
  emit("SQL final records in four separately owned databases", c);
  const forbidden = await call(
    stack,
    "inventory",
    "/api/v1/reservations/" + b.id + "/release",
    { method: "POST" },
  );
  assert.equal(forbidden.status, 409);
  emit("BR5 paid reservation cannot be released", forbidden);
  emit("PASS main transaction crosses Booking Inventory Payment Notification");
  return b.id;
}
export async function concurrency(stack) {
  emit("COMMAND 25 parallel POST /api/v1/reservations capacity 5");
  const id = await workshop(stack, "concurrency", 5);
  const results = await Promise.all(
    Array.from({ length: 25 }, () =>
      call(stack, "inventory", "/api/v1/reservations", {
        method: "POST",
        key: "reserve:" + randomUUID(),
        body: { bookingId: randomUUID(), workshopId: id },
      }),
    ),
  );
  const accepted = results.filter((r) => r.status === 201).length,
    rejected = results.filter(
      (r) => r.status === 409 && r.body.error.code === "SOLD_OUT",
    ).length;
  assert.equal(accepted, 5);
  assert.equal(rejected, 20);
  emit("Parallel outcome", {
    parallelRequests: 25,
    capacity: 5,
    succeeded: accepted,
    rejected,
    error: results.find((r) => r.status === 409).body,
  });
  const rows = await query(
    stack,
    "inventory",
    "SELECT w.id,w.capacity,w.available,count(r.booking_id)::int AS allocations FROM workshops w LEFT JOIN reservations r ON r.workshop_id=w.id WHERE w.id=$1 GROUP BY w.id",
    [id],
  );
  assert.equal(rows[0].available, 0);
  assert.equal(rows[0].allocations, 5);
  emit("SQL inventory final state", rows);
  emit("COMMAND additional 20 concurrent end to end bookings capacity 5");
  const second = await workshop(stack, "booking-race", 5);
  const submissions = await Promise.all(
    Array.from({ length: 20 }, () => book(stack, second)),
  );
  const end = Date.now() + 20000;
  let final;
  while (Date.now() < end) {
    final = await query(
      stack,
      "booking",
      "SELECT state,count(*)::int AS count FROM bookings WHERE workshop_id=$1 GROUP BY state",
      [second],
    );
    if (final.every((r) => ["CONFIRMED", "REJECTED"].includes(r.state))) break;
    await sleep(100);
  }
  assert.equal(final.find((r) => r.state === "CONFIRMED")?.count, 5);
  assert.equal(final.find((r) => r.state === "REJECTED")?.count, 15);
  emit("SQL end to end outcomes", final);
  emit("PASS BR1 no over allocation in either concurrent experiment");
}
export async function idempotency(stack) {
  emit(
    "COMMAND two simultaneous identical booking requests with same Idempotency-Key",
  );
  const id = await workshop(stack, "idempotency", 2);
  const key = "idem:" + randomUUID();
  const [first, simultaneous] = await Promise.all([
    book(stack, id, key),
    book(stack, id, key),
  ]);
  assert.deepEqual(first.body, simultaneous.body);
  const repeats = [];
  for (let i = 0; i < 3; i++) {
    const r = await book(stack, id, key);
    assert.deepEqual(r.body, first.body);
    assert.equal(r.replay, "true");
    repeats.push(r);
  }
  emit("First response", first);
  emit("Simultaneous response", simultaneous);
  emit("Three sequential replays", repeats);
  const conflict = await call(stack, "booking", "/api/v1/bookings", {
    method: "POST",
    key,
    body: { workshopId: id, customer: "Different learner" },
  });
  assert.equal(conflict.status, 409);
  emit("Changed payload response", conflict);
  await poll(stack, first.body.id);
  await notice(stack, first.body.id);
  const idem = await query(
    stack,
    "booking",
    "SELECT key,fingerprint,status,response FROM idempotency WHERE key=$1",
    [key],
  );
  emit("SQL persisted key fingerprint and original response", idem);
  const c = await counts(stack, first.body.id);
  assert.equal(c.booking.length, 1);
  assert.equal(c.payments.length, 1);
  assert.equal(c.notifications.length, 1);
  emit("SQL one booking one charge one notification", c);
  const chargeId = randomUUID(),
    chargeKey = "direct:" + chargeId;
  const direct = await Promise.all(
    Array.from({ length: 10 }, () =>
      call(stack, "payment", "/api/v1/charges", {
        method: "POST",
        key: chargeKey,
        body: { bookingId: chargeId, amountCents: 500 },
      }),
    ),
  );
  assert(
    direct.every((r) => r.status === 201 && r.body.id === direct[0].body.id),
  );
  assert.equal(
    (
      await query(
        stack,
        "payment",
        "SELECT * FROM payments WHERE booking_id=$1",
        [chargeId],
      )
    ).length,
    1,
  );
  emit("10 simultaneous direct payment calls", {
    requests: 10,
    distinctChargeIds: new Set(direct.map((r) => r.body.id)).size,
  });
  emit(
    "PASS BR2 same key same result changed payload rejected simultaneous duplicates safe",
  );
}
export async function resilience(stack) {
  emit(
    "COMMAND mock commits charge then delays first response past 300 ms timeout",
  );
  await mode(stack, "slow_after_commit");
  const id = await workshop(stack, "lost-response");
  const a = await book(stack, id);
  await poll(stack, a.body.id);
  const rows = await query(
    stack,
    "payment",
    "SELECT id,state FROM payments WHERE booking_id=$1",
    [a.body.id],
  );
  assert.equal(rows.length, 1);
  emit("SQL charge after timeout and safe retry", rows);
  await mode(stack, "normal");
  emit("COMMAND stop the real Payment service process");
  await stack.stop("payment");
  const wid = await workshop(stack, "stopped-payment");
  const b = await book(stack, wid);
  await sleep(1700);
  const pending = (
    await call(stack, "booking", "/api/v1/bookings/" + b.body.id)
  ).body;
  assert.equal(pending.state, "PAYMENT_PENDING");
  assert.equal(pending.last_error, "DEPENDENCY_UNAVAILABLE");
  emit("Graceful durable pending state after bounded retries", pending);
  const inv = await query(
    stack,
    "inventory",
    "SELECT id,available FROM workshops WHERE id=$1",
    [wid],
  );
  assert.equal(inv[0].available, 0);
  emit("SQL seat stays reserved while payment outcome is unknown", inv);
  emit("COMMAND restart Payment service");
  await stack.start("payment");
  await poll(stack, b.body.id);
  await notice(stack, b.body.id);
  const c = await counts(stack, b.body.id);
  assert.equal(c.payments.length, 1);
  emit("Recovered state without duplicate charge", c);
  emit("COMMAND force a definitive mock payment decline");
  await mode(stack, "decline");
  const declined = await workshop(stack, "decline");
  const d = await book(stack, declined);
  await poll(stack, d.body.id, "REJECTED");
  const released = await query(
    stack,
    "inventory",
    "SELECT id,available FROM workshops WHERE id=$1",
    [declined],
  );
  assert.equal(released[0].available, 1);
  emit("SQL declined booking releases its seat", released);
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await call(
          stack,
          "inventory",
          "/api/v1/reservations/" + d.body.id + "/release",
          { method: "POST" },
        )
      ).status,
      200,
    );
  assert.equal(
    (
      await query(
        stack,
        "inventory",
        "SELECT available FROM workshops WHERE id=$1",
        [declined],
      )
    )[0].available,
    1,
  );
  emit("BR5 repeated release leaves exactly one available seat");
  await mode(stack, "normal");
  emit(
    "PASS timeout exponential backoff jitter stopped dependency recovery and no duplicate charge",
  );
}
export async function recovery(stack) {
  emit("COMMAND stop Notification service then submit a booking");
  await stack.stop("notification");
  const wid = await workshop(stack, "outbox");
  const a = await book(stack, wid);
  await poll(stack, a.body.id);
  await sleep(1300);
  const outbox = await query(
    stack,
    "booking",
    "SELECT * FROM outbox WHERE booking_id=$1",
    [a.body.id],
  );
  assert.equal(outbox[0].delivered, false);
  emit("Confirmed booking with durable undelivered outbox", outbox);
  emit("COMMAND restart Notification service");
  await stack.start("notification");
  await notice(stack, a.body.id);
  await sleep(200);
  const c = await counts(stack, a.body.id);
  assert.equal(c.notifications.length, 1);
  emit("SQL eventual single delivery", c);
  emit("COMMAND restart Booking during unknown payment outcome");
  await mode(stack, "unavailable");
  const wid2 = await workshop(stack, "restart");
  const b = await book(stack, wid2);
  await sleep(1400);
  await stack.stop("booking");
  await mode(stack, "normal");
  await stack.start("booking");
  await poll(stack, b.body.id);
  const r = await counts(stack, b.body.id);
  assert.equal(r.payments.length, 1);
  emit("Persisted workflow resumes after Booking process restart", r);
  emit("PASS outbox and workflow survive process failures");
}
export async function contracts(stack) {
  emit("COMMAND validate service contracts and malformed requests");
  for (const n of names) {
    const r = await call(stack, n, "/openapi.json");
    assert.equal(r.body.openapi, "3.1.0");
  }
  const invalid = await call(stack, "booking", "/api/v1/bookings", {
    method: "POST",
    key: "invalid",
    body: { workshopId: "x", customer: "x", priceCents: 1 },
  });
  assert.equal(invalid.status, 422);
  assert(invalid.body.error.correlationId);
  const missing = await call(stack, "booking", "/api/v1/bookings", {
    method: "POST",
    body: { workshopId: "x", customer: "x" },
  });
  assert.equal(missing.status, 400);
  emit("Consistent validation errors", { invalid, missing });
  // Infrastructure evidence may connect to databases; application services never do.
  const pg = (await import("pg")).default;
  const denied = [];
  for (const n of names) {
    const other = names[(names.indexOf(n) + 1) % 4];
    const u = new URL(stack.dbs[n]);
    u.pathname = "/sf_" + other;
    const c = new pg.Client({ connectionString: u.toString() });
    try {
      await c.connect();
      throw new Error("Cross database connection unexpectedly succeeded");
    } catch (err) {
      assert.equal(err.code, "42501");
      denied.push({ service: n, otherDatabase: other, sqlstate: err.code });
    } finally {
      await c.end().catch(() => {});
    }
  }
  emit(
    "Separate credentials cannot connect to another service database",
    denied,
  );
  emit("PASS contracts validation and credential isolation");
}
export const scenarios = {
  health,
  main,
  concurrency,
  idempotency,
  resilience,
  recovery,
  contracts,
};
