import { idempotencySchema, transaction, context } from "@seatflow/common";
import { randomUUID } from "node:crypto";
import { assertTransition, assertPaid } from "./domain.mjs";
export const schema =
  `
CREATE TABLE IF NOT EXISTS bookings(
 id uuid PRIMARY KEY,workshop_id text NOT NULL,customer text NOT NULL,
 state text NOT NULL CHECK(state IN ('PENDING','RESERVED','PAYMENT_PENDING','PAID','CONFIRMED','RELEASING','REJECTED')),
 price_cents integer,payment_id uuid,correlation_id text NOT NULL,last_error text,
 next_attempt timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS outbox(booking_id uuid PRIMARY KEY REFERENCES bookings(id),customer text NOT NULL,delivered boolean NOT NULL DEFAULT false);
` + idempotencySchema;
export async function create(client, b) {
  const id = randomUUID();
  await client.query(
    "INSERT INTO bookings(id,workshop_id,customer,state,correlation_id) VALUES($1,$2,$3,'PENDING',$4)",
    [id, b.workshopId, b.customer, context.getStore()?.id ?? id],
  );
  return {
    status: 202,
    body: { id, status: "ACCEPTED", statusUrl: "/api/v1/bookings/" + id },
  };
}
export async function move(db, b, to, values = {}) {
  assertTransition(b.state, to);
  if (to === "CONFIRMED") assertPaid(b.state);
  return transaction(db, async (c) => {
    const {
      rows: [row],
    } = await c.query(
      "UPDATE bookings SET state=$2,price_cents=COALESCE($3,price_cents),payment_id=COALESCE($4,payment_id),last_error=$5,next_attempt=now() WHERE id=$1 AND state=$6 RETURNING *",
      [
        b.id,
        to,
        values.price ?? null,
        values.payment ?? null,
        values.error ?? null,
        b.state,
      ],
    );
    if (!row) throw new Error("State changed despite advisory lock");
    if (to === "CONFIRMED")
      await c.query(
        "INSERT INTO outbox(booking_id,customer) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [b.id, b.customer],
      );
    return row;
  });
}
