import { Fault, z } from "@seatflow/common";
export const workshopInput = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,60}$/),
    title: z.string().min(1).max(100),
    capacity: z.number().int().min(1).max(1000),
    priceCents: z.number().int().min(1).max(10000000),
  })
  .strict();
export const reservationInput = z
  .object({
    bookingId: z.string().uuid(),
    workshopId: z.string().regex(/^[a-z0-9-]{1,60}$/),
  })
  .strict();
// BR1 is also enforced atomically in SQL; a precheck alone is insufficient.
export function assertCapacity(rowCount) {
  if (!rowCount) throw new Fault(409, "SOLD_OUT", "No seat is available");
}
// BR5 final states cannot be reversed.
export function reservationTransition(from, to) {
  if (from === to) return false;
  if (from !== "RESERVED" || !["CONFIRMED", "RELEASED"].includes(to))
    throw new Fault(409, "INVALID_TRANSITION", "Reservation is already final");
  return true;
}
