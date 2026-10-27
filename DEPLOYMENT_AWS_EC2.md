# Deploying SeatFlow to AWS EC2

This guide deploys the full SeatFlow stack (Postgres, inventory, payment, notification, booking and the React UI) to a single EC2 instance using Docker Compose.

**Architecture**

```
Browser ──HTTP :5173──▶ ui (Vite dev server)
                          │  proxies /svc/<name>/* over the Docker network
                          ├──▶ booking:8081
                          ├──▶ inventory:8082
                          ├──▶ payment:8083
                          └──▶ notification:8084
                                    all ──▶ postgres:5432
```

Only port 5173 (UI) and port 22 (SSH) need to be reachable from the internet. The service ports (8081-8084) and Postgres (15432) stay closed in the security group.

---

## 1. Prerequisites

- An AWS account with an Ubuntu EC2 instance running (t2.micro or larger)
- The project on your laptop, with `docker-compose.yml` working locally
- An SSH key pair for the instance (.pem)

---

## 3. AWS setup

### 3.1 Security group (inbound rules)

| Type       | Port | Source    | Purpose      |
| ---------- | ---- | --------- | ------------ |
| SSH        | 22   | My IP     | Admin access |
| Custom TCP | 5173 | 0.0.0.0/0 | UI           |

Do **not** open 8081-8084 or 15432. Compose publishes them on all interfaces, so the security group is what keeps them private.

Note: if you set SSH to `0.0.0.0/0` (access from anywhere), keep password login off and your private key safe. Switch it back to "My IP" when you are done.

### 3.2 Elastic IP (recommended)

Without an Elastic IP, the public IP changes every time the instance is stopped and started. Allocate one in EC2 → Elastic IPs and associate it with the instance.

## 4. Connect to the instance

```bash
ssh -i seatflow-new.pem ubuntu@<EC2_PUBLIC_IP>
```

Type `yes` on the first connection. Use `exit` (or Ctrl+D) to disconnect.

---

## 5. Prepare the server

### 5.1 Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit        # log out and back in so the group applies
```

Reconnect and check: `docker compose version`.

---

## 6. Deploy

### 6.1 Get the Code base on deployment directory

```bash
mkdir Development && cd Development
mkdir DockerDeployment && cd DockerDeployment
git clone https://github.com/tirtharajsinha/Scalable_Services_Assignment1.git
```

### 6.2 Start the stack

```bash
cd Scalable_Services_Assignment1
docker compose up -d --build
docker compose ps
```

Wait until the services show `healthy`.

---

## 7. Access the UI

Open this in your browser (type it manually and use `http`, not `https`):

```
http://<EC2_PUBLIC_IP>:5173
```

All four health dots at the top of the page should be green.

Optional: to serve on plain port 80, change the `ui` port mapping in `docker-compose.yml` to `"80:5173"`, open port 80 in the security group, then run `docker compose up -d`.

---

## 8. Updating the deployment

After changing code on your laptop:

```bash
# pull from remote repo
git pull

# on the server
docker compose up -d --build            # everything
```

Hard-refresh the browser (Ctrl+Shift+R) after a UI change.

---

## 9. Useful commands

```bash
docker compose ps                    # status and health
docker compose logs -f <service>     # follow logs (ui, booking, payment, ...)
docker compose restart <service>
docker compose down                  # stop everything (keeps DB volume)
docker compose down -v               # stop and delete the database volume
free -h                              # memory and swap
```

---

## 10. Troubleshooting

| Symptom                                                           | Likely cause and fix                                                                                                                                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser times out on `:5173`                                      | Port 5173 not open in the security group, or your network blocks it (try phone data). Alternative: map the UI to port 80.                                                         |
| Console opened from the AWS "open address" link fails             | That link uses `https` on port 443. Use `http://<ip>:5173`.                                                                                                                       |
| Black screen, console shows `crypto.randomUUID is not a function` | Section 2.2 fix is missing in the running container. Update `api.js`, then `docker compose up -d --build ui`. Verify with `docker compose exec ui grep -n randomUUID src/api.js`. |
| Health dots red                                                   | `docker compose ps` and `docker compose logs <service>`. Often the DB is not ready or an env var is missing.                                                                      |
| `curl localhost:5173` works but browser does not                  | Security group or local network.                                                                                                                                                  |
| "Blocked request. This host is not allowed" in UI logs            | You are using a domain name. Add `allowedHosts: ["your.domain"]` under `server` in `vite.config.js`.                                                                              |
| Build killed or containers restarting                             | Out of memory. Add swap (section 5.2).                                                                                                                                            |
| Bookings take a while to settle                                   | `WORKER_INTERVAL_MS` is 10000 on booking, so the workflow advances about every 10 s.                                                                                              |
| `Connection timed out` on SSH                                     | SSH rule does not allow your current IP. Set source to My IP again.                                                                                                               |
| `Permission denied (publickey)`                                   | Server does not have your public key. See section 4.1.                                                                                                                            |
| `UNPROTECTED PRIVATE KEY FILE`                                    | Run `chmod 400 <keyfile>`.                                                                                                                                                        |

---

## 11. Security notes

- Never commit `.pem` or private key files to git. Add `*.pem`, `seatflow-new` and `.env` to `.gitignore`.
- If a private key may have leaked: restrict SSH to your IP, replace `authorized_keys` with a new public key, check `last -a` and `docker ps` for anything unfamiliar, and delete the old key everywhere (including git history).
- The default compose credentials (`postgres/postgres`, service passwords) and the unauthenticated APIs are fine for a coursework demo only. Do not put real data on this deployment.
- The Vite dev server is not a production server. For production, build the UI and serve it with nginx, and add HTTPS with a domain name and Certbot.
- Stop or terminate the instance when you are done to avoid charges.

## 12 Create an SSH key pair (Original .pem file is not usable)

Generate the key on your own machine and never paste the private key anywhere.

```bash
ssh-keygen -t ed25519 -f seatflow-new -C "seatflow"
chmod 400 seatflow-new
```

This creates:

- `seatflow-new` – private key (keep secret, use with `ssh -i`)
- `seatflow-new.pub` – public key (goes on the server)

The extension does not matter to SSH. Optionally copy it to a `.pem` name:

```bash
cp seatflow-new seatflow-new.pem && chmod 400 seatflow-new.pem
```

Keep your current session open, because it is your only way in right now.

1. On your laptop (Fedora), print the public key

```bash
cat seatflow-new.pub
```

It’s a single long line like ssh-ed25519 AAAAC3Nza… tirtha@fedora. Copy the whole line. Make sure it’s the .pub file and not the private key.

2. On the server, replace the bad line

```bash
nano ~/.ssh/authorized_keys
```

Delete the existing line and paste the public key. Save with Ctrl+O, Enter, then Ctrl+X. Or in one command, replacing the quoted text with your line:

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

3. Check the file

```bash
cat ~/.ssh/authorized_keys
```

It should show one line starting with ssh-ed25519.

4. Test in a second terminal before closing the first

```bash
ssh -i seatflow-new ubuntu@13.233.41.24
```

---
