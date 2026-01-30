# Install Docker and run the project (macOS)

## 1. Install Docker Desktop

1. Go to **[Docker Desktop for Mac](https://www.docker.com/products/docker-desktop/)**.
2. Download the right version:
   - **Apple Silicon** (M1/M2/M3) – “Mac with Apple chip”
   - **Intel** – “Mac with Intel chip”
3. Open the `.dmg`, drag **Docker** into **Applications**.
4. Open **Docker** from Applications (or Spotlight).
5. Accept the terms and wait until the menu bar shows **“Docker Desktop is running”**.

**Alternative (Homebrew):**

```bash
brew install --cask docker
```

Then open Docker from Applications.

## 2. Check Docker

In a terminal:

```bash
docker --version
docker compose version
```

You should see version numbers for both.

## 3. Run the project

From the **project root** (where `docker-compose.yml` is):

```bash
docker compose up -d --build
```

- First run: builds images and starts all containers.
- Later: starts existing containers. Use `docker compose up -d --build` again after code changes to rebuild.

## 4. Verify

- **Orchestrator:** http://localhost:3000  
  - Health: `curl http://localhost:3000/health`
- **RabbitMQ Management:** http://localhost:15672 (user: `scale`, pass: `scale_secret`)

Test a request:

```bash
curl -X POST http://localhost:3000/any/path \
  -H "X-Routing-Key: logging" \
  -H "Content-Type: application/json" \
  -d '{"event":"test"}'
```

## 5. Useful commands

| Command | Description |
|--------|-------------|
| `docker compose up -d --build` | Start (and rebuild) all services |
| `docker compose down` | Stop and remove containers |
| `docker compose logs -f` | Follow logs (all services) |
| `docker compose logs -f orchestrator` | Follow orchestrator logs only |
