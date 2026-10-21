import { remote, context, log } from "@seatflow/common";
import { move } from "./repository.mjs";
const inventory = process.env.INVENTORY_URL,
  payment = process.env.PAYMENT_URL,
  notification = process.env.NOTIFICATION_URL;
async function step(db, b) {
  if (b.state === "PENDING") {
    const r = await remote(inventory + "/api/v1/reservations", {
      method: "POST",
      key: "reserve:" + b.id,
      body: { bookingId: b.id, workshopId: b.workshop_id },
    });
    if (r.status === 409 || r.status === 404)
      return move(db, b, "REJECTED", { error: r.body.error.code });
    if (r.status !== 201)
      throw new Error("Unexpected reservation response " + r.status);
    return move(db, b, "RESERVED", { price: r.body.price_cents });
  }
  if (b.state === "RESERVED") return move(db, b, "PAYMENT_PENDING");
  if (b.state === "PAYMENT_PENDING") {
    const r = await remote(payment + "/api/v1/charges", {
      method: "POST",
      key: "charge:" + b.id,
      body: { bookingId: b.id, amountCents: b.price_cents },
    });
    if (r.status === 402)
      return move(db, b, "RELEASING", { error: "PAYMENT_DECLINED" });
    if (r.status !== 201)
      throw new Error("Unexpected payment response " + r.status);
    return move(db, b, "PAID", { payment: r.body.id });
  }
  if (b.state === "PAID") {
    const r = await remote(
      inventory + "/api/v1/reservations/" + b.id + "/confirm",
      { method: "POST" },
    );
    if (r.status !== 200)
      throw new Error("Unexpected confirmation response " + r.status);
    return move(db, b, "CONFIRMED");
  }
  if (b.state === "RELEASING") {
    const r = await remote(
      inventory + "/api/v1/reservations/" + b.id + "/release",
      { method: "POST" },
    );
    if (r.status !== 200)
      throw new Error("Unexpected release response " + r.status);
    return move(db, b, "REJECTED", { error: "PAYMENT_DECLINED" });
  }
}
async function processBooking(db, id) {
  const lock = await db.connect();
  try {
    const {
      rows: [{ acquired }],
    } = await lock.query(
      "SELECT pg_try_advisory_lock(hashtextextended($1,0)) acquired",
      [id],
    );
    if (!acquired) return;
    try {
      let {
        rows: [b],
      } = await db.query("SELECT * FROM bookings WHERE id=$1", [id]);
      await context.run({ id: b.correlation_id }, async () => {
        try {
          // Persist every step. After a crash, replay the external operation with its stable key.
          while (!["CONFIRMED", "REJECTED"].includes(b.state)) {
            b = await step(db, b);
            log("booking_state", { bookingId: id, state: b.state });
          }
        } catch (err) {
          await db.query(
            "UPDATE bookings SET last_error=$2,next_attempt=now()+interval '1 second' WHERE id=$1",
            [id, err.code ?? err.message],
          );
          log("booking_waiting", {
            bookingId: id,
            reason: err.code ?? err.message,
          });
        }
      });
    } finally {
      await lock.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
        id,
      ]);
    }
  } finally {
    lock.release();
  }
}
async function deliverOutbox(db) {
  const { rows } = await db.query(
    "SELECT o.*,b.correlation_id FROM outbox o JOIN bookings b ON b.id=o.booking_id WHERE NOT delivered LIMIT 4",
  );
  for (const item of rows)
    await context.run({ id: item.correlation_id }, async () => {
      try {
        const r = await remote(notification + "/api/v1/notifications", {
          method: "POST",
          key: "notice:" + item.booking_id,
          body: {
            bookingId: item.booking_id,
            customer: item.customer,
            message: "BOOKING_CONFIRMED",
          },
        });
        if (r.status !== 201) throw new Error("Notification rejected");
        await db.query("UPDATE outbox SET delivered=true WHERE booking_id=$1", [
          item.booking_id,
        ]);
        log("notification_delivered", { bookingId: item.booking_id });
      } catch (err) {
        log("notification_waiting", {
          bookingId: item.booking_id,
          reason: err.code ?? err.message,
        });
      }
    });
}
export function startWorker(db) {
  let busy = false,
    stopped = false;
  const timer = setInterval(
    async () => {
      if (busy || stopped) return;
      busy = true;
      try {
        const { rows } = await db.query(
          "SELECT id FROM bookings WHERE state NOT IN ('CONFIRMED','REJECTED') AND next_attempt<=now() ORDER BY next_attempt LIMIT 4",
        );
        await Promise.all(rows.map((b) => processBooking(db, b.id)));
        await deliverOutbox(db);
      } catch (err) {
        log("worker_error", { message: err.message });
      } finally {
        busy = false;
      }
    },
    Number(process.env.WORKER_INTERVAL_MS ?? 150),
  );
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
