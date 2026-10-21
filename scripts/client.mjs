import { randomUUID } from "node:crypto";
const inventory = process.env.INVENTORY_URL ?? "http://127.0.0.1:8082",
  booking = process.env.BOOKING_URL ?? "http://127.0.0.1:8081";
const id = "workshop-" + randomUUID().slice(0, 8);
async function request(url, body, key) {
  const r = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await r.json();
  console.log(
    new Date().toISOString(),
    r.status,
    JSON.stringify(result, null, 2),
  );
  if (!r.ok) throw new Error("Request failed");
  return result;
}
await request(
  inventory + "/api/v1/workshops",
  { id, title: "Distributed systems workshop", capacity: 5, priceCents: 25000 },
  "create:" + id,
);
const accepted = await request(
  booking + "/api/v1/bookings",
  { workshopId: id, customer: "Demo learner" },
  "book:" + randomUUID(),
);
for (let i = 0; i < 100; i++) {
  const row = await request(booking + accepted.statusUrl);
  if (["CONFIRMED", "REJECTED"].includes(row.state)) break;
  await new Promise((r) => setTimeout(r, 300));
}
