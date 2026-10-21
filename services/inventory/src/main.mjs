import { pool, appFor, listen } from "@seatflow/common";
import { schema } from "./repository.mjs";
import { routes } from "./api.mjs";
import spec from "../../../docs/openapi/inventory.json" with { type: "json" };
const db = pool();
await db.query(schema);
const app = appFor("inventory", db, spec);
routes(app, db);
listen(app, db);
