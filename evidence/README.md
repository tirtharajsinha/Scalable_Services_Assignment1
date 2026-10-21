# Evidence index

Every JSONL record includes an execution timestamp. Screenshots show the actual command, output and IST clock from a local API client that executes the repository's real scripts. The client display is presentation support; results are asserted by scripts and checked in PostgreSQL.

- challenge-1-concurrency: 25 reservations for 5 seats, plus 20 full bookings for 5 seats.
- challenge-2-idempotency: simultaneous and sequential duplicates, changed payload conflict, persisted fingerprint/response, one booking and one charge.
- challenge-3a-resilience: post-commit response loss, bounded retries, real Payment stop/restart, decline release, Notification and Booking restart recovery.
- tests: 14 unit tests, health, main flow, validation, OpenAPI availability and separate database credentials.
- service-logs: structured application logs with propagated correlationId, downstream_retry and idempotency_replay events.
- screenshots: unmodified captures of the running demonstration console. Source JSONL files provide the raw, searchable evidence.

Repeated script runs use new resource IDs. JSONL scenario evidence stores the most recent successful run; service logs can include multiple runs. Match booking IDs and correlation IDs rather than relying only on log order.
