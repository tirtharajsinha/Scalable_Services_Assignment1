# Challenge 2 idempotency

Run: node scripts/evidence.mjs --scenario idempotency

idempotency.jsonl records the first and simultaneous 202 responses, three identical sequential replays, a 409 for a changed payload, the persisted key/fingerprint/response and one booking/charge/message. Ten parallel direct charges also return the same charge ID.

screenshots/06-idempotency.png and 07-idempotency-database.png show responses and persisted state. 08-replay-log.png shows actual Payment idempotency_replay logs. Raw structured logs are in ../service-logs.

The common idempotent helper claims a unique key, runs the business effect and stores its response in one transaction. A competing request waits for the unique-key transaction, then reads its committed result. Same-key/different-payload requests return 409. Semantic JSON canonicalization makes object property order irrelevant.
