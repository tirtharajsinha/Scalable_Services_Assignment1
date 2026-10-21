# Tests

Run npm test for the 14 unit tests. unit.txt is the raw captured output.
Run npm run evidence for seven scenario groups. full-run.txt records the whole run, including failures if any; the successful scenario files are health.jsonl, main.jsonl and contracts.jsonl here, and the challenge folders.

contracts checks /openapi.json on all services, validation status 422, missing key status 400 and consistent JSON errors. It tries four cross-database connections with the wrong service credentials and requires SQLSTATE 42501. This is a representative ring of denied connections; it does not claim exhaustive operating-system isolation.

main verifies reservation CONFIRMED, payment CHARGED, one notification and a forbidden release of paid inventory. Screenshot 13-tests.png shows unit test execution in the demo.
