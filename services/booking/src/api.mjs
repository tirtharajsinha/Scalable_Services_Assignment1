import { z, idempotent, send, finish, Fault } from "@seatflow/common";
import { bookingInput } from "./domain.mjs";
import { create } from "./repository.mjs";
export function routes(app, db) {
  app.post("/api/v1/bookings", async (req, res) => {
    const b = bookingInput.parse(req.body);
    const result = await idempotent(db, req.get("Idempotency-Key"), b, (c) =>
      create(c, b),
    );
    res.set("Location", result.body.statusUrl);
    send(res, result);
  });
  app.get("/api/v1/bookings/:id", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const {
      rows: [row],
    } = await db.query("SELECT * FROM bookings WHERE id=$1", [id]);
    if (!row) throw new Fault(404, "BOOKING_NOT_FOUND", "Booking not found");
    res.json(row);
  });
  finish(app);
}
