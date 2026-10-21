import test from "node:test";
import assert from "node:assert/strict";
import { assertPaid, assertTransition, bookingInput } from "../src/domain.mjs";
test("BR4 confirmation needs a known successful payment", () => {
  assert.throws(() => assertPaid("PAYMENT_PENDING"), {
    code: "PAYMENT_REQUIRED",
  });
  assert.doesNotThrow(() => assertPaid("PAID"));
});
test("Final booking state cannot go backwards", () => {
  assert.throws(() => assertTransition("CONFIRMED", "PENDING"), {
    code: "INVALID_TRANSITION",
  });
  assert.doesNotThrow(() => assertTransition("PAYMENT_PENDING", "RELEASING"));
});
test("Booking does not accept a customer supplied price", () => {
  assert.equal(
    bookingInput.safeParse({ workshopId: "w", customer: "c", priceCents: 1 })
      .success,
    false,
  );
});
