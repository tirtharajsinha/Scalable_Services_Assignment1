import { z } from "@seatflow/common";
export const chargeInput = z
  .object({
    bookingId: z.string().uuid(),
    amountCents: z.number().int().min(1).max(10000000),
  })
  .strict();
// BR3 payment outcome is a mock policy, never a real financial integration.
export function paymentOutcome(mode) {
  return mode === "decline" ? "DECLINED" : "CHARGED";
}
