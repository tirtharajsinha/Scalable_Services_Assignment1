# Docker setup for SeatFlow

This project is designed as four independent Node services with separate PostgreSQL databases:

- Booking: http://localhost:8081
- Inventory: http://localhost:8082
- Payment: http://localhost:8083
- Notification: http://localhost:8084
- PostgreSQL: localhost:15432

## Files created

- `docker-compose.yml` — local Compose stack for development and testing
- `docker-stack.yml` — basic Docker Swarm example for orchestration experiments
- `docker/postgres/Dockerfile`
- `docker/postgres/init.sql`

## Start the stack with Docker Compose

```bash
docker compose up --build -d
```

## Check service health

```bash
curl http://localhost:8081/health
curl http://localhost:8082/health
curl http://localhost:8083/health
curl http://localhost:8084/health
```

## Stop the stack

```bash
docker compose down
```

## Optional: Docker Swarm

A basic Swarm example is provided in `docker-stack.yml`.

### Working local Swarm sequence

Use this exact sequence for a clean local one-node Swarm demo. If the app containers fail with `Role "sf_booking" does not exist`, the previous Postgres data volume is stale and must be removed.

```bash
docker swarm init

docker stack rm seatflow || true
docker volume ls
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

Check the app health after deployment:

```bash
curl http://localhost:8081/health
curl http://localhost:8082/health
curl http://localhost:8083/health
curl http://localhost:8084/health
```

If `docker volume ls` shows a different Postgres volume name, remove that matching volume instead of `seatflow_postgres_data`.

Note: this is a simple orchestration proof-of-concept. Swarm is not a drop-in replacement for the Compose setup and would need additional work for production-grade persistence, secrets, and multi-node database handling.

## Notes

- The Postgres container is initialized with the required database roles and service databases.
- The app services are configured to connect over Docker networking using the service names (`postgres`, `inventory`, `payment`, `notification`).
- The Compose stack is the recommended local development setup.
- The Swarm file is intended for experimentation and learning, not as a fully hardened production deployment.

## Verification

The stack was validated successfully with fresh runtime checks:

- `docker compose ps` showed all containers running and healthy.
- Each service responded successfully on its health endpoint.

Example successful responses:

```json
{"service":"booking","status":"ok"}
{"service":"inventory","status":"ok"}
{"service":"payment","status":"ok"}
{"service":"notification","status":"ok"}
```
