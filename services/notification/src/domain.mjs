import { z } from "@seatflow/common";
export const noticeInput = z
  .object({
    bookingId: z.string().uuid(),
    customer: z.string().min(1).max(80),
    message: z.literal("BOOKING_CONFIRMED"),
  })
  .strict();
// BR6 each confirmed booking produces one logical message.
export function notificationKey(bookingId) {
  return "notice:" + bookingId;
}
