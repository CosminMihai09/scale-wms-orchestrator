# Scale WMS – Orchestrator microservicii (POC)

API Orchestrator care primește cereri de la sistemul de management al depozitului (Scale) și le direcționează către microservicii prin **RabbitMQ**. Direcționarea se face pe baza **header-elor HTTP**, astfel că WMS trebuie doar să apeleze un singur endpoint și să seteze header-ul corespunzător.

## Arhitectură

```
  [Scale WMS]  -->  [Orchestrator API]  -->  [RabbitMQ]
                            |                      |
                            v                      v
                    Header X-Routing-Key    Topic exchange "scale.topic"
                                                    |
                    +----------------+---------------+----------------+
                    |                |               |                |
                    v                v               v                v
            [Logging]        [Reporting]      [Mock Worker]    (servicii viitoare)
```

- **Orchestrator**: Un singur API Express; acceptă orice cale/metodă, citește cheia de rutare din header, publică în RabbitMQ, **așteaptă răspunsul** de la microserviciu, apoi returnează acel răspuns către WMS (request–reply). Dacă nu primește răspuns în timeout, returnează `504 Gateway Timeout`.
- **RabbitMQ**: Topic exchange `scale.topic`; chei de rutare: `logging`, `reporting`, `worker`. O coadă dedicată de răspuns `orchestrator.replies` este folosită pentru răspunsurile microserviciilor.
- **Microservicii**: Fiecare consumă propria coadă, procesează mesajul, **trimite un răspuns** (status + body) înapoi în coada de răspuns a orchestratorului, apoi face ack. Repornire automată în Docker.

## Rutare (header-e)

WMS trebuie să trimită cheia de rutare într-un header HTTP. Orchestratorul verifică (în ordine):

| Header            | Valoare exemplu   |
|-------------------|-------------------|
| `x-routing-key`   | `logging`         |
| `X-Routing-Key`   | `reporting`       |
| `x-scale-routing-key` | `worker`     |

**Chei de rutare POC:**

| Routing key  | Microserviciu     | Scop              |
|--------------|-------------------|-------------------|
| `logging`    | Serviciu logging  | Evenimente log    |
| `reporting`  | Serviciu reporting| Evenimente raport |
| `worker`     | Mock worker       | Job-uri generice  |

Dacă header-ul lipsește, orchestratorul returnează `400` cu un indiciu.

## Request–reply (returnarea datelor către WMS)

Orchestratorul **așteaptă un răspuns** de la microserviciu și îl returnează către WMS:

1. WMS trimite cererea către orchestrator cu `X-Routing-Key`.
2. Orchestratorul publică în RabbitMQ cu un **correlation ID** și numele **cozii de răspuns**.
3. Microserviciul țintă procesează mesajul și **publică un răspuns** în coada de răspuns cu același correlation ID.
4. Orchestratorul primește răspunsul și **răspunde către WMS** cu acel răspuns (status HTTP și body).

**Format răspuns** (microserviciu → orchestrator): JSON cu opțional `statusCode` (implicit `200`) și `body`. Orchestratorul transmite `statusCode` ca status HTTP și `body` ca body al răspunsului. Exemplu de la un microserviciu:

```json
{ "statusCode": 200, "body": { "ok": true, "items": [] } }
```

**Timeout**: Dacă microserviciul nu răspunde în **30 de secunde** (configurabil prin `REPLY_TIMEOUT_MS`), orchestratorul returnează **504 Gateway Timeout** către WMS.

## Considerații de performanță

Când WMS trimite multe cereri simultan (ex. 100 cereri concurente), sistemul se comportă astfel:

- **Orchestrator (Express)**  
  Node este single-threaded dar non-blocking. Toate cererile sunt acceptate și tratate concurent. Fiecare cerere primește propriul correlation ID, publică în RabbitMQ și așteaptă răspunsul (o Promise). Asta nu blochează celelalte cereri. Deci multe cereri în zbor (ex. 100) sunt în regulă: multe promise-uri în așteptare și multe conexiuni HTTP în așteptare. Nu e nevoie de modificări pentru concurență la orchestrator.

- **RabbitMQ**  
  Toate mesajele sunt publicate în exchange și rutează către cozile potrivite. RabbitMQ suportă volum mare de mesaje; nu este un bottleneck.

- **Microservicii (câte o instanță fiecare)**  
  Fiecare serviciu are un consumer per instanță și procesează câte un mesaj odată din coada sa. Dacă multe cereri merg către **aceeași** cheie de rutare (ex. toate către `logging`), ele se aliniază la coadă și acea singură instanță le procesează una după alta. Prima cerere primește răspuns rapid; cele ulterioare pot aștepta (ex. a 100-a așteaptă după celelalte 99). Dacă traficul e **împărțit** între logging, reporting și worker, fiecare serviciu primește o parte și rulează în paralel, dar în interiorul fiecărui serviciu procesarea rămâne una câte una.

- **Răspunsuri**  
  Răspunsurile pot sosi în orice ordine. Orchestratorul potrivește fiecare răspuns cu cererea HTTP corectă după correlation ID și trimite acel răspuns către WMS. Fără confuzie.

- **Scalare**  
  Pentru a gestiona sarcină mare pe o anumită cheie de rutare, rulează **mai multe instanțe** ale aceluiași microserviciu (ex. `docker compose up -d --scale logging-service=3`). Toate instanțele consumă din aceeași coadă; RabbitMQ distribuie mesajele între ele. Throughput-ul și latența se îmbunătățesc fără modificări de cod.

## Pornire (Docker)

```bash
docker compose up -d
```

- **Orchestrator**: http://localhost:3000  
- **RabbitMQ Management**: http://localhost:15672 (user: `scale`, parolă: `scale_secret`)

Container-ele folosesc `restart: unless-stopped`, deci repornesc după crash-uri sau repornirea hostului.

## Test rapid (de pe host)

```bash
# Health
curl http://localhost:3000/health

# Rutare către logging
curl -X POST http://localhost:3000/any/path \
  -H "X-Routing-Key: logging" \
  -H "Content-Type: application/json" \
  -d '{"event":"test","level":"info"}'

# Rutare către reporting
curl -X POST http://localhost:3000/reports/daily \
  -H "X-Routing-Key: reporting" \
  -H "Content-Type: application/json" \
  -d '{"report":"inventory"}'

# Rutare către mock worker
curl -X POST http://localhost:3000/jobs/process \
  -H "X-Routing-Key: worker" \
  -H "Content-Type: application/json" \
  -d '{"jobId":"123"}'
```

Fiecare cerere returnează **răspunsul microserviciului** (ex. `200` cu body JSON). Verifică răspunsul orchestratorului și log-urile fiecărui serviciu:

```bash
docker compose logs -f logging-service
docker compose logs -f reporting-service
docker compose logs -f mock-worker-service
```

## Integrare WMS

Punctează Scale către URL-ul de bază al orchestratorului (ex. `http://orchestrator-host:3000`). Pentru fiecare tip de integrare:

1. **URL**: Același URL de bază; calea poate fi orice (ex. `/scale/logging`, `/scale/reporting`, `/scale/worker`).
2. **Header-e**: Setează `X-Routing-Key` (sau `x-routing-key`) la una dintre: `logging`, `reporting`, `worker`.
3. **Body**: JSON/payload-ul tău existent; este transmis în body-ul mesajului către microserviciul corespunzător.

Orchestratorul transmite metoda, calea, query-ul, header-ele și body-ul în mesajul RabbitMQ, astfel că serviciile au context complet. WMS primește răspunsul microserviciului (status și body) ca răspuns HTTP.

## Structura proiectului

```
.
├── docker-compose.yml      # RabbitMQ + orchestrator + 3 servicii POC
├── orchestrator/           # API Express, publică în RabbitMQ
├── logging-service/       # Consumă "logging"
├── reporting-service/     # Consumă "reporting"
├── mock-worker-service/   # Consumă "worker"
└── README.md
```

## Adăugarea de microservicii noi

1. Adaugă un folder pentru noul serviciu (ex. `inventory-service/`) cu propriul `Dockerfile` și consumer care leagă o coadă de `scale.topic` cu o cheie de rutare nouă (ex. `inventory`).
2. Adaugă serviciul și `RABBITMQ_URL` în `docker-compose.yml` cu `restart: unless-stopped`.
3. În consumer: la procesarea unui mesaj, dacă `msg.properties.replyTo` și `msg.properties.correlationId` sunt setate, trimite răspuns cu `channel.sendToQueue(replyTo, content, { correlationId })`. Body-ul răspunsului trebuie să fie JSON: `{ statusCode?: number, body?: any }`.
4. În WMS, folosește același URL al orchestratorului și setează `X-Routing-Key: inventory` (sau cheia ta). Nu e nevoie de modificări la orchestrator.
