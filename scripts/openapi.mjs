import { mkdir, writeFile } from "node:fs/promises";
const text = { type: "string" },
  uuid = { type: "string", format: "uuid" },
  int = { type: "integer" };
const error = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message", "correlationId"],
      properties: { code: text, message: text, correlationId: text },
    },
  },
};
const key = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  schema: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
};
const corr = {
  name: "X-Correlation-ID",
  in: "header",
  required: false,
  schema: text,
};
const obj = (properties, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
const workshop = obj({
  id: { type: "string", pattern: "^[a-z0-9-]{1,60}$" },
  title: { type: "string", minLength: 1, maxLength: 100 },
  capacity: { ...int, minimum: 1, maximum: 1000 },
  priceCents: { ...int, minimum: 1, maximum: 10000000 },
});
const booking = obj({
  workshopId: { type: "string", pattern: "^[a-z0-9-]{1,60}$" },
  customer: { type: "string", minLength: 1, maxLength: 80 },
});
const reservation = obj({
  bookingId: uuid,
  workshopId: { type: "string", pattern: "^[a-z0-9-]{1,60}$" },
});
const charge = obj({
  bookingId: uuid,
  amountCents: { ...int, minimum: 1, maximum: 10000000 },
});
const notice = obj({
  bookingId: uuid,
  customer: { type: "string", minLength: 1, maxLength: 80 },
  message: { type: "string", enum: ["BOOKING_CONFIRMED"] },
});
const rows = {
  inventory: [
    ["post", "/api/v1/workshops", "Create a workshop", workshop, 201, true],
    ["get", "/api/v1/workshops", "List inventory", null, 200],
    [
      "post",
      "/api/v1/reservations",
      "Reserve exactly one seat",
      reservation,
      201,
      true,
    ],
    ["get", "/api/v1/reservations/{id}", "Read reservation", null, 200],
    [
      "post",
      "/api/v1/reservations/{id}/confirm",
      "Confirm reservation",
      null,
      200,
    ],
    [
      "post",
      "/api/v1/reservations/{id}/release",
      "Release an unpaid reservation",
      null,
      200,
    ],
  ],
  booking: [
    [
      "post",
      "/api/v1/bookings",
      "Accept booking and start durable workflow",
      booking,
      202,
      true,
    ],
    ["get", "/api/v1/bookings/{id}", "Read persisted booking state", null, 200],
  ],
  payment: [
    [
      "post",
      "/api/v1/charges",
      "Mock charge once per booking",
      charge,
      201,
      true,
    ],
    ["get", "/api/v1/charges/{bookingId}", "Read mock charge", null, 200],
    [
      "post",
      "/api/v1/simulation",
      "Configure mock only when ENABLE_SIMULATION is true",
      obj({
        mode: {
          type: "string",
          enum: ["normal", "unavailable", "slow_after_commit", "decline"],
        },
      }),
      200,
    ],
  ],
  notification: [
    [
      "post",
      "/api/v1/notifications",
      "Persist a mock delivery",
      notice,
      201,
      true,
    ],
    [
      "get",
      "/api/v1/notifications/{bookingId}",
      "Read mock delivery",
      null,
      200,
    ],
  ],
};
await mkdir("docs/openapi", { recursive: true });
for (const [name, endpoints] of Object.entries(rows)) {
  const paths = {};
  for (const [method, path, summary, body, status, idem] of [
    ["get", "/health", "Check process and own database", null, 200],
    ["get", "/openapi.json", "Read OpenAPI contract", null, 200],
    ...endpoints,
  ]) {
    const parameters = [
      corr,
      ...(idem ? [key] : []),
      ...[...path.matchAll(/{([^}]+)}/g)].map((m) => ({
        name: m[1],
        in: "path",
        required: true,
        schema: uuid,
      })),
    ];
    const responses = {
      [status]: {
        description:
          status === 202
            ? "Accepted; poll Location. Replays keep the original 202 body."
            : "Success",
        headers: {
          "X-Correlation-ID": { schema: text },
          ...(idem
            ? { "Idempotency-Replayed": { schema: { type: "boolean" } } }
            : {}),
          ...(status === 202 ? { Location: { schema: text } } : {}),
        },
        content: {
          "application/json": {
            schema:
              status === 202
                ? obj({
                    id: uuid,
                    status: { type: "string", enum: ["ACCEPTED"] },
                    statusUrl: text,
                  })
                : { type: ["object", "array"] },
          },
        },
      },
    };
    for (const code of [400, 404, 409, 422, 500, 503])
      responses[code] = {
        description: {
          400: "Missing or invalid idempotency key",
          404: "Not found",
          409: "Conflict or sold out",
          422: "Validation failed",
          500: "Internal error",
          503: "Temporarily unavailable",
        }[code],
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      };
    if (name === "payment" && path === "/api/v1/charges")
      responses[402] = {
        description: "Mock payment declined",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      };
    (paths[path] ??= {})[method] = {
      summary,
      operationId: name + "_" + method + "_" + path.replace(/[^a-z0-9]/gi, "_"),
      parameters,
      responses,
      ...(body
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: body } },
            },
          }
        : {}),
    };
  }
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "SeatFlow " + name + " API",
      version: "1.0.0",
      description:
        "Local coursework demonstration. No real payment or message delivery.",
    },
    servers: [
      {
        url:
          "http://127.0.0.1:" +
          { booking: 8081, inventory: 8082, payment: 8083, notification: 8084 }[
            name
          ],
      },
    ],
    paths,
    components: { schemas: { Error: error } },
  };
  await writeFile(
    "docs/openapi/" + name + ".json",
    JSON.stringify(spec, null, 2) + "\n",
  );
}
console.log("Generated four OpenAPI 3.1 contracts");
