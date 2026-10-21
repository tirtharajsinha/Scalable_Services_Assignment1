import test from "node:test";
import assert from "node:assert/strict";
import { chargeInput, paymentOutcome } from "../src/domain.mjs";
test("BR3 amounts must be positive integer minor currency units", () => {
  for (const amountCents of [0, -1, 0.5])
    assert.equal(
      chargeInput.safeParse({
        bookingId: "83fc42e0-bb4d-4cd8-939c-29f9c1f8936f",
        amountCents,
      }).success,
      false,
    );
});
test("Mock decline has no successful charge state", () => {
  assert.equal(paymentOutcome("decline"), "DECLINED");
  assert.equal(paymentOutcome("normal"), "CHARGED");
});
