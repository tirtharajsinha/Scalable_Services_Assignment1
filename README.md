# SeatFlow workshop bookings

A small distributed booking system for Scalable Services (SEZG583), Assignment 1. Four services own four PostgreSQL databases and separate logins. Booking persists a workflow that reserves a seat, records a mock charge, confirms the reservation and eventually delivers a mock notification. This repository chooses **Challenge 3A Resilience**, alongside mandatory concurrency and idempotency.

## Quick start

Prerequisites: Node.js 22 or later (validated with 24.13.1), npm, and an x64 Windows or supported macOS/Linux machine. First installation needs internet access to download npm dependencies and native PostgreSQL binaries. Run from this directory in a normal user account; PostgreSQL cannot run as root on Linux.

```text
npm ci
npm start
```

The local launcher starts an actual native PostgreSQL server on 127.0.0.1:15432 and four independent Node processes. It creates sf_booking, sf_inventory, sf_payment and sf_notification databases with different randomly generated passwords, revokes PUBLIC access and grants each role access only to its own database. Generated credentials are under .runtime/dev and must stay private. This is a development launcher, not a shared application database.

| Service      | Port | Health  | Contract      |
| ------------ | ---: | ------- | ------------- |
| Booking      | 8081 | /health | /openapi.json |
| Inventory    | 8082 | /health | /openapi.json |
| Payment      | 8083 | /health | /openapi.json |
| Notification | 8084 | /health | /openapi.json |

Leave the launcher running in one terminal. In a second terminal, use scripts/client.mjs to create an example workshop and booking against the dev ports:

```text
node scripts/client.mjs
```

Ctrl+C stops only the launcher's child services and database. Data persists across starts. The dev launcher binds to loopback. Windows shutdown uses pg_ctl with a fast, clean database shutdown.

## Run each service independently

Each service has its own package.json, src, tests, .env.example and Dockerfile. Install dependencies at the workspace root with npm ci. The shared package contains transport, logging and transaction plumbing; no business entities or database credentials are shared.

After the launcher creates the databases, a service can be launched separately using its generated environment file, while the other services and PostgreSQL stay running:

```text
node --env-file=.runtime/dev/inventory.env services/inventory/src/main.mjs
```

First stop that inventory process through your process manager, or select an unused PORT. For an externally provisioned PostgreSQL server, create four databases with four different owners, revoke PUBLIC CONNECT, copy each .env.example, and supply only that service's DATABASE_URL. No service needs the administrator credential.

Configuration: PORT, HOST, DATABASE_URL, DB_POOL_SIZE, INVENTORY_URL, PAYMENT_URL, NOTIFICATION_URL, HTTP_TIMEOUT_MS, RETRY_ATTEMPTS, RETRY_BASE_MS, WORKER_INTERVAL_MS, ENABLE_SIMULATION, MOCK_DELAY_MS. URL values are needed only by Booking; simulation values only by Payment. PORT and DATABASE_URL are required for independently launched services. Set HOST=0.0.0.0 for containers. Launchers have documented local defaults; service configuration is supplied through environment variables.

## Start the compose

```bash
docker compose up --build -d
```

## Docker and Swarm

For the local Compose workflow, see the stack command above. For the demo Swarm setup used in this repo, run the full local reset and deploy sequence documented in [DOCKER.md](DOCKER.md):

```bash
docker swarm init
docker stack rm seatflow || true
docker volume rm seatflow_postgres_data

docker build -t seatflow-postgres:local ./docker/postgres
docker build -t seatflow-booking:local -f services/booking/Dockerfile .
docker build -t seatflow-inventory:local -f services/inventory/Dockerfile .
docker build -t seatflow-payment:local -f services/payment/Dockerfile .
docker build -t seatflow-notification:local -f services/notification/Dockerfile .

docker stack deploy -c docker-stack.yml seatflow
docker service ls
docker stack ps seatflow
```

If the app fails with PostgreSQL role errors, remove the stale Postgres volume first and redeploy; the same reset steps are described in [DOCKER.md](DOCKER.md).

## Tests and repeatable evidence

```text
npm test
npm run evidence
node scripts/evidence.mjs --scenario concurrency
node scripts/evidence.mjs --scenario idempotency
node scripts/evidence.mjs --scenario resilience
```

The evidence runner owns an isolated local stack on ports 18081 to 18084 and PostgreSQL 15433, so it does not modify the dev stack. Run only one evidence runner at a time. It preserves its data to allow inspection, and uses new workshop IDs and request keys for each run. Seven scenario groups cover health, main transaction, concurrency, idempotency, resilience, process recovery, and API/credential checks. Each failure exits nonzero. Scripts connect to databases only to provision or collect evidence; application services never read another service's database.

Observed results: 14 unit tests pass; 7 scenario groups pass. The inventory test sends 25 parallel reservations against capacity 5 and observes 5 successes and 20 HTTP 409 SOLD_OUT rejections. A second test submits 20 complete bookings and observes 5 confirmed and 15 rejected. The idempotency test includes simultaneous arrivals, three sequential replays, a changed-payload conflict, and 10 simultaneous mock payment calls creating one charge.

Resilience stops an actual payment process, observes PAYMENT_PENDING with a reserved seat, restarts it and checks a single eventual charge. The mock also commits a payment and delays its first response beyond the HTTP timeout, proving retry safety. A definitive decline releases the seat. Recovery tests stop Notification and restart Booking, checking durable outbox and workflow recovery.

See evidence/README.md and the per-challenge README files. Raw JSONL logs and timestamped screenshots accompany the scripts. npm test output is in evidence/tests/unit.txt. No production performance, load capacity or exactly-once network delivery claim is made.

## API flow

Create a workshop in Inventory, then submit Booking with Idempotency-Key and a JSON body containing workshopId and customer. POST returns HTTP 202 and a statusUrl. Repeating the same key returns the same accepted resource and original 202 body, even after it completes. Poll GET /api/v1/bookings/{id} for its current state. A changed payload under an existing key returns 409. The caller cannot set price; Booking obtains the price from the reservation.

Errors have the common shape:

```json
{
  "error": {
    "code": "SOLD_OUT",
    "message": "No seat is available",
    "correlationId": "request-id"
  }
}
```

Endpoints are versioned under /api/v1; /health and /openapi.json are operational paths. JSON schema validation rejects unknown properties. Internal operations have stable keys reserve:<bookingId>, charge:<bookingId> and notice:<bookingId>. Confirm and release are semantically idempotent state transitions. Correlation IDs propagate through HTTP and are persisted for background processing.

## Business rules and traceability

| Rule                                                                         | Enforcement                                                   | Unit test                               | Integration evidence                                |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------- |
| BR1 Seats never exceed capacity                                              | inventory repository reserve; conditional UPDATE and CHECK    | inventory domain test                   | concurrency                                         |
| BR2 Same key same semantic payload has one effect; changed payload conflicts | common idempotent; unique key + fingerprint + cached response | common fingerprint test                 | idempotency and direct payment race                 |
| BR3 Price uses positive integer cents and Booking gets it from Inventory     | payment chargeInput; bookingInput excludes price              | payment amount test; booking input test | main and contracts                                  |
| BR4 Confirm only after a known successful payment                            | booking assertPaid and allowed transitions                    | booking payment test                    | resilience and main                                 |
| BR5 Release at most once; never release confirmed inventory                  | inventory transition with row lock                            | inventory transition test               | declined repeated release and paid release conflict |
| BR6 One logical confirmation message per booking                             | unique notifications.booking_id; stable key; booking outbox   | notification stable key test            | idempotency and recovery                            |

## Design choices and limits

The public request is asynchronous so a slow dependency cannot hold the client's request open. The worker is part of Booking, not another business service. It writes each state before moving on. PostgreSQL session advisory locks serialize workers per booking; connection loss releases the lock. Inventory uses atomic conditional UPDATE, not a process-local mutex. The idempotency key claim, business effect and saved response commit in one local transaction.

A payment timeout means the outcome is unknown, so inventory remains reserved. This trades availability for integrity. The workflow resumes after the provider returns. There is no automated expiry, operator cancellation or reconciliation UI. There are no real payments or emails. Authentication, hostile-client access, real provider contracts, broker-based messaging, production scaling, and high availability are outside this assignment. Internal APIs assume trusted local callers; a production system must authorize transitions and validate provider receipts. Idempotency records are retained indefinitely for the demo; production needs a documented retention window. Process crashes are tested; a simultaneous database or disk failure is not.

Dockerfiles are provided for Assignment 2 preparation. Container deployment and Minikube have not been exercised in this environment. Schemas initialize idempotently on startup for coursework; production would use versioned migrations and separately scoped migration credentials.

## Submission

Editable design report: docs/SeatFlow_Design_Report.docx. Update member details, contribution confirmation, reflections and the external submission links, then export the report to PDF in Word. Main report is within the 15-page limit; appendices are separate.

Silent demo and timed speaking script are in the delivery folder alongside the project archive. Four equal sections correspond to the four named members. The team records its own audio and publishes the final video. See docs/SUBMISSION.md. No fictional commit authors, personal experiences or hosting URLs have been created.

AI assistance is declared in the report appendix and docs/AI_USE.md.
