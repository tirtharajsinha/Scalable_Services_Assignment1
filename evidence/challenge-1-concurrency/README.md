# Challenge 1 concurrency

Run: node scripts/evidence.mjs --scenario concurrency

concurrency.jsonl contains the command and timestamp, 25 requests, 5 successful allocations, 20 HTTP 409 SOLD_OUT responses and final SQL state capacity=5, available=0, allocations=5. It also records 20 simultaneous complete bookings with 5 CONFIRMED and 15 REJECTED.

screenshots/05-concurrency.png shows the live result. In source, services/inventory/src/repository.mjs uses an atomic conditional UPDATE and inserts the reservation in the same transaction. PostgreSQL row locks serialize competing updates; each checks available>0 against the current row. An application check followed by a separate update allows two requests to observe the same remaining seat and oversell it.
