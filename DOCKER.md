# Docker setup for SeatFlow

This project is designed as four independent Node services with separate PostgreSQL databases:

- Booking: http://localhost:8081
- Inventory: http://localhost:8082
- Payment: http://localhost:8083
- Notification: http://localhost:8084
- PostgreSQL: localhost:15432

## Files created

- `docker-compose.yml`
- `docker/postgres/Dockerfile`
- `docker/postgres/init.sql`

## Start the stack

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

## Notes

- The Postgres container is initialized with the required database roles and service databases.
- The app services are configured to connect over Docker networking using the service names (`postgres`, `inventory`, `payment`, `notification`).
- The stack is meant for local development and container-based orchestration testing.

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
