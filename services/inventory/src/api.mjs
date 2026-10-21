import { z, idempotent, send, finish, Fault } from "@seatflow/common";
import { workshopInput, reservationInput } from "./domain.mjs";
import { reserve, transition } from "./repository.mjs";
export function routes(app, db) {
  app.post("/api/v1/workshops", async (req, res) => {
    const b = workshopInput.parse(req.body);
    send(
      res,
      await idempotent(db, req.get("Idempotency-Key"), b, async (c) => {
        const {
          rows: [row],
        } = await c.query(
          "INSERT INTO workshops VALUES($1,$2,$3,$3,$4) ON CONFLICT DO NOTHING RETURNING *",
          [b.id, b.title, b.capacity, b.priceCents],
        );
        if (!row)
          throw new Fault(409, "WORKSHOP_EXISTS", "Workshop already exists");
        return { status: 201, body: row };
      }),
    );
  });
  app.get("/api/v1/workshops", async (_req, res) =>
    res.json((await db.query("SELECT * FROM workshops ORDER BY id")).rows),
  );
  app.post("/api/v1/reservations", async (req, res) => {
    const b = reservationInput.parse(req.body);
    send(
      res,
      await idempotent(db, req.get("Idempotency-Key"), b, (c) => reserve(c, b)),
    );
  });
  app.get("/api/v1/reservations/:id", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const {
      rows: [row],
    } = await db.query("SELECT * FROM reservations WHERE booking_id=$1", [id]);
    if (!row) {
      const { Fault } = await import("@seatflow/common");
      throw new Fault(404, "RESERVATION_NOT_FOUND", "Reservation not found");
    }
    res.json(row);
  });
  app.post("/api/v1/reservations/:id/:action", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const action = z.enum(["confirm", "release"]).parse(req.params.action);
    res.json(
      await transition(db, id, action === "confirm" ? "CONFIRMED" : "RELEASED"),
    );
  });
  finish(app);
}
