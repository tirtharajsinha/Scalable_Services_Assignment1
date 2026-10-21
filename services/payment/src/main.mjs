import { pool, appFor, listen } from "@seatflow/common";
import { schema } from "./repository.mjs";
import { routes } from "./api.mjs";
import spec from "../../../docs/openapi/payment.json" with { type: "json" };
const db = pool();
await db.query(schema);
const app = appFor("payment", db, spec);
routes(app, db);
listen(app, db);
