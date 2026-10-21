import test from "node:test";
import assert from "node:assert/strict";
import { notificationKey, noticeInput } from "../src/domain.mjs";
test("BR6 retries derive a stable notification key", () => {
  assert.equal(notificationKey("b1"), notificationKey("b1"));
  assert.notEqual(notificationKey("b1"), notificationKey("b2"));
});
test("Only the booking confirmation message is accepted", () => {
  assert.equal(
    noticeInput.safeParse({
      bookingId: "83fc42e0-bb4d-4cd8-939c-29f9c1f8936f",
      customer: "c",
      message: "OTHER",
    }).success,
    false,
  );
});
