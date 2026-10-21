import { idempotencySchema, Fault, context } from "@seatflow/common";
import { randomUUID } from "node:crypto";
import { paymentOutcome } from "./domain.mjs";

export const schema = `
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL UNIQUE,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  state text NOT NULL CHECK (state IN ('CHARGED', 'DECLINED'))
);
CREATE TABLE IF NOT EXISTS simulation (
  id integer PRIMARY KEY CHECK (id = 1), mode text NOT NULL
);
INSERT INTO simulation VALUES (1, 'normal') ON CONFLICT DO NOTHING;
` + idempotencySchema;

function resultFor(row) {
  if (row.state === "CHARGED") return { status: 201, body: row };
  return {
    status: 402,
    body: {
      error: {
        code: "PAYMENT_DECLINED",
        message: "Mock payment was declined",
        correlationId: context.getStore()?.id ?? "unknown",
      },
      payment: row,
    },
  };
}

export async function charge(client, input, mode) {
  // Also serialize different operation keys targeting the same business booking.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1))", [input.bookingId]);
  const { rows: [existing] } = await client.query(
    "SELECT * FROM payments WHERE booking_id=$1", [input.bookingId],
  );
  if (existing) {
    if (existing.amount_cents !== input.amountCents) {
      throw new Fault(409, "PAYMENT_CONFLICT", "Amount cannot change for a booking");
    }
    return resultFor(existing);
  }
  const { rows: [row] } = await client.query(
    "INSERT INTO payments VALUES($1,$2,$3,$4) RETURNING *",
    [randomUUID(), input.bookingId, input.amountCents, paymentOutcome(mode)],
  );
  return resultFor(row);
}
