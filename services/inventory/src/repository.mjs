import { transaction, idempotencySchema, Fault } from "@seatflow/common";
import { assertCapacity, reservationTransition } from "./domain.mjs";
export const schema =
  `
CREATE TABLE IF NOT EXISTS workshops(
 id text PRIMARY KEY,title text NOT NULL,capacity integer NOT NULL CHECK(capacity>0),
 available integer NOT NULL CHECK(available>=0 AND available<=capacity),price_cents integer NOT NULL CHECK(price_cents>0));
CREATE TABLE IF NOT EXISTS reservations(
 booking_id uuid PRIMARY KEY,workshop_id text NOT NULL REFERENCES workshops(id),
 state text NOT NULL CHECK(state IN ('RESERVED','CONFIRMED','RELEASED')),price_cents integer NOT NULL);
` + idempotencySchema;
export async function reserve(client, input) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1))", [
    input.bookingId,
  ]);
  const {
    rows: [old],
  } = await client.query("SELECT * FROM reservations WHERE booking_id=$1", [
    input.bookingId,
  ]);
  if (old) {
    if (old.workshop_id !== input.workshopId)
      throw new Fault(
        409,
        "BOOKING_CONFLICT",
        "Booking already refers to a different workshop",
      );
    return { status: 201, body: old };
  }
  // Database serializes competing updates and rechecks available > 0.
  const result = await client.query(
    "UPDATE workshops SET available=available-1 WHERE id=$1 AND available>0 RETURNING price_cents",
    [input.workshopId],
  );
  const exists = await client.query("SELECT 1 FROM workshops WHERE id=$1", [
    input.workshopId,
  ]);
  if (!exists.rowCount)
    throw new Fault(404, "WORKSHOP_NOT_FOUND", "Workshop not found");
  assertCapacity(result.rowCount);
  const {
    rows: [row],
  } = await client.query(
    "INSERT INTO reservations VALUES($1,$2,'RESERVED',$3) RETURNING *",
    [input.bookingId, input.workshopId, result.rows[0].price_cents],
  );
  return { status: 201, body: row };
}
export async function transition(db, id, to) {
  return transaction(db, async (client) => {
    const {
      rows: [row],
    } = await client.query(
      "SELECT * FROM reservations WHERE booking_id=$1 FOR UPDATE",
      [id],
    );
    if (!row)
      throw new Fault(404, "RESERVATION_NOT_FOUND", "Reservation not found");
    if (reservationTransition(row.state, to)) {
      await client.query(
        "UPDATE reservations SET state=$2 WHERE booking_id=$1",
        [id, to],
      );
      if (to === "RELEASED")
        await client.query(
          "UPDATE workshops SET available=available+1 WHERE id=$1",
          [row.workshop_id],
        );
    }
    return { ...row, state: to };
  });
}
