import { z, idempotent, send, finish, Fault } from "@seatflow/common";
import { noticeInput } from "./domain.mjs";
import { deliver } from "./repository.mjs";
export function routes(app, db) {
  app.post("/api/v1/notifications", async (req, res) => {
    const b = noticeInput.parse(req.body);
    send(
      res,
      await idempotent(db, req.get("Idempotency-Key"), b, (c) => deliver(c, b)),
    );
  });
  app.get("/api/v1/notifications/:bookingId", async (req, res) => {
    const id = z.uuid().parse(req.params.bookingId);
    const {
      rows: [row],
    } = await db.query("SELECT * FROM notifications WHERE booking_id=$1", [id]);
    if (!row)
      throw new Fault(404, "NOTIFICATION_NOT_FOUND", "Notification not found");
    res.json(row);
  });
  finish(app);
}
