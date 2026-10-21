# Challenge 3A resilience

Run: node scripts/evidence.mjs --scenario resilience
Extra recovery: node scripts/evidence.mjs --scenario recovery

resilience.jsonl records a successful charge despite the first response exceeding the 300ms timeout, an actual Payment process stop, durable PAYMENT_PENDING and held inventory, restart recovery with one charge, and a definitive decline with one seat released. A repeated release does not increment stock twice.

recovery.jsonl records a confirmed booking with an undelivered outbox while Notification is stopped, eventual single delivery after restart, and Booking process restart recovery.

screenshots/09-payment-down.png, 10-recovery.png, 11-retry-log.png and 12-outbox.png link the running display to these claims. ../service-logs/booking.jsonl shows downstream_retry with attempt number, delayMs, URL and correlationId. The retry delay is floor(base*2^attempt + random()*base). There are at most three attempts per worker operation; later worker rounds retry durable pending work.

A timeout does not prove a payment failed. The design retains the seat on uncertainty and repeats a stable charge key. This avoids overselling paid inventory, at the cost of seats remaining reserved during a long outage. No expiry or production reconciliation guarantee is claimed.
