import { idempotencySchema } from "@seatflow/common";
import { randomUUID } from "node:crypto";
export const schema =
  `CREATE TABLE IF NOT EXISTS notifications(id uuid PRIMARY KEY,booking_id uuid UNIQUE NOT NULL,customer text NOT NULL,message text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());` +
  idempotencySchema;
export async function deliver(client, b) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1))", [
    b.bookingId,
  ]);
  const {
    rows: [old],
  } = await client.query("SELECT * FROM notifications WHERE booking_id=$1", [
    b.bookingId,
  ]);
  if (old) {
    if (old.customer !== b.customer || old.message !== b.message) {
      const { Fault } = await import("@seatflow/common");
      throw new Fault(
        409,
        "NOTIFICATION_CONFLICT",
        "Booking notification payload cannot change",
      );
    }
    return { status: 201, body: old };
  }
  const {
    rows: [row],
  } = await client.query(
    "INSERT INTO notifications(id,booking_id,customer,message) VALUES($1,$2,$3,$4) ON CONFLICT(booking_id) DO UPDATE SET booking_id=EXCLUDED.booking_id RETURNING *",
    [randomUUID(), b.bookingId, b.customer, b.message],
  );
  return { status: 201, body: row };
}
