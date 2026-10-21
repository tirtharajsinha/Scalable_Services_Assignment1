import { z, Fault } from "@seatflow/common";
export const bookingInput = z
  .object({
    workshopId: z.string().regex(/^[a-z0-9-]{1,60}$/),
    customer: z.string().trim().min(1).max(80),
  })
  .strict();
export const transitions = {
  PENDING: ["RESERVED", "REJECTED"],
  RESERVED: ["PAYMENT_PENDING"],
  PAYMENT_PENDING: ["PAID", "RELEASING"],
  PAID: ["CONFIRMED"],
  RELEASING: ["REJECTED"],
  CONFIRMED: [],
  REJECTED: [],
};
export function assertTransition(from, to) {
  if (!transitions[from]?.includes(to))
    throw new Fault(409, "INVALID_TRANSITION", from + " cannot become " + to);
}
// BR4 only a known successful payment permits confirmation.
export function assertPaid(state) {
  if (state !== "PAID")
    throw new Fault(
      409,
      "PAYMENT_REQUIRED",
      "Payment must be known successful",
    );
}
