import { z, idempotent, send, finish, Fault, sleep } from "@seatflow/common";
import { chargeInput } from "./domain.mjs";
import { charge } from "./repository.mjs";
export function routes(app, db) {
  app.post("/api/v1/charges", async (req, res) => {
    const b = chargeInput.parse(req.body);
    const {
      rows: [sim],
    } = await db.query("SELECT mode FROM simulation WHERE id=1");
    if (sim.mode === "unavailable")
      throw new Fault(503, "MOCK_UNAVAILABLE", "Mock gateway is unavailable");
    const result = await idempotent(db, req.get("Idempotency-Key"), b, (c) =>
      charge(c, b, sim.mode),
    );
    if (sim.mode === "slow_after_commit" && !result.replay)
      await sleep(Number(process.env.MOCK_DELAY_MS ?? 1200));
    send(res, result);
  });
  app.get("/api/v1/charges/:bookingId", async (req, res) => {
    const id = z.uuid().parse(req.params.bookingId);
    const {
      rows: [row],
    } = await db.query("SELECT * FROM payments WHERE booking_id=$1", [id]);
    if (!row) throw new Fault(404, "PAYMENT_NOT_FOUND", "Payment not found");
    res.json(row);
  });
  app.post("/api/v1/simulation", async (req, res) => {
    if (process.env.ENABLE_SIMULATION !== "true")
      throw new Fault(404, "NOT_FOUND", "Simulation is disabled");
    const b = z
      .object({
        mode: z.enum(["normal", "unavailable", "slow_after_commit", "decline"]),
      })
      .strict()
      .parse(req.body);
    await db.query("UPDATE simulation SET mode=$1 WHERE id=1", [b.mode]);
    res.json(b);
  });
  finish(app);
}
