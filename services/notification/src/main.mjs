import { pool, appFor, listen } from "@seatflow/common";
import { schema } from "./repository.mjs";
import { routes } from "./api.mjs";
import spec from "../../../docs/openapi/notification.json" with { type: "json" };
const db = pool();
await db.query(schema);
const app = appFor("notification", db, spec);
routes(app, db);
listen(app, db);
