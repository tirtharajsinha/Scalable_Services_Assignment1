import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCapacity,
  reservationTransition,
  workshopInput,
} from "../src/domain.mjs";
test("BR1 capacity rejects a failed atomic update", () => {
  assert.throws(() => assertCapacity(0), { code: "SOLD_OUT" });
  assert.doesNotThrow(() => assertCapacity(1));
});
test("BR5 repeated release is harmless and paid inventory cannot release", () => {
  assert.equal(reservationTransition("RELEASED", "RELEASED"), false);
  assert.throws(() => reservationTransition("CONFIRMED", "RELEASED"), {
    code: "INVALID_TRANSITION",
  });
  assert.equal(reservationTransition("RESERVED", "RELEASED"), true);
});
test("Inventory rejects fractional capacity and untrusted fields", () => {
  assert.equal(
    workshopInput.safeParse({
      id: "x",
      title: "x",
      capacity: 1.5,
      priceCents: 500,
    }).success,
    false,
  );
  assert.equal(
    workshopInput.safeParse({
      id: "x",
      title: "x",
      capacity: 1,
      priceCents: 500,
      extra: 1,
    }).success,
    false,
  );
});
