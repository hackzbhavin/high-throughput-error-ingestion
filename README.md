# high-throughput-error-ingestion

An async error deduplication pipeline built to understand what changes when you move the database out of the request path.

Built as a deliberate contrast to [error-logger-naive-to-production](https://github.com/yourusername/error-logger-naive-to-production) — same problem, different architecture, very different results under load.

***

## Architecture

```mermaid
flowchart LR
    Client -->|POST /errors/log| API[NestJS API]

    subgraph hot["Hot Path  ~3ms"]
        API --> Redis[(Redis\nINCR)]
        Redis --> Queue[BullMQ\nQueue]
    end

    API -->|200 queued| Client

    subgraph async["Async Worker"]
        Queue --> Worker[Processor]
        Worker --> MySQL[(MySQL\nINSERT IGNORE)]
    end

    subgraph cron["Every 30s"]
        Cron --> Redis
        Cron --> MySQL
    end

    style hot fill:#1a3a2a,color:#fff,stroke:#2ecc71
    style async fill:#1a2a3a,color:#fff,stroke:#3498db
    style cron fill:#2a1a3a,color:#fff,stroke:#9b59b6
    style Client fill:#2d6a9f,color:#fff,stroke:none
    style Redis fill:#a93226,color:#fff,stroke:none
    style MySQL fill:#6b2737,color:#fff,stroke:none
```

The API responds after enqueuing to Redis (~3ms). MySQL never touches the hot path.

***

## How a Request Flows

```mermaid
sequenceDiagram
    actor Client
    participant API as NestJS
    participant R as Redis
    participant Q as BullMQ
    participant W as Worker
    participant DB as MySQL

    Client->>API: POST /errors/log

    rect rgb(20, 60, 40)
        note right of API: Hot path — ~3ms
        API->>API: SHA256 → fingerprint
        API->>R: INCR error:{fingerprint}
        API->>Q: enqueue job
        API-->>Client: 200 { status: "queued" }
    end

    rect rgb(20, 40, 70)
        note right of Q: Async — decoupled
        Q-->>W: process job
        W->>DB: INSERT IGNORE
    end

    rect rgb(50, 20, 70)
        note right of DB: Every 30s
        API->>R: read all fingerprint counts
        API->>DB: UPSERT count + lastSeenAt
    end
```

***

## Why Each Decision Was Made

```mermaid
flowchart TD
    subgraph Old["What the naive version does"]
        O1[SELECT fingerprint] --> O2{exists?}
        O2 -->|yes| O3[UPDATE count]
        O2 -->|no| O4[INSERT record]
        O3 --> O5[respond ~200ms]
        O4 --> O5
    end

    subgraph New["What this version does"]
        N1[Redis INCR\natomic ~0.5ms] --> N2[Enqueue job\n~1ms]
        N2 --> N3[respond ~3ms]
        N2 -.->|async| N4[INSERT IGNORE\nno race condition]
    end

    style Old fill:#5c1a1a,color:#fff,stroke:none
    style New fill:#1a472a,color:#fff,stroke:none
```

| Decision | Why |
|---|---|
| `Redis INCR` instead of `UPDATE count++` | Atomic. No lock. No race. ~0.5ms vs ~20ms |
| `INSERT IGNORE` instead of `findOne + insert` | DB enforces uniqueness. No app-level race condition possible |
| BullMQ queue instead of direct DB write | API response time becomes Redis speed, not MySQL speed |
| Cron sync every 30s | 1 DB write per fingerprint per 30s instead of 1 per request |

***

## Stack

| Layer | Tech | Purpose |
|---|---|---|
| HTTP | NestJS | API framework |
| Cache + Queue | Redis + BullMQ | Atomic counters, async job transport |
| Database | MySQL + TypeORM | Persistent storage |
| Metrics | prom-client | Prometheus histograms per layer |
| Containers | cAdvisor | CPU + memory per container |
| Dashboards | Grafana | Everything on one screen during load test |
| Load Testing | k6 | Traffic generation + Prometheus remote write |

***

## Project Structure

```
src/
├── errors/
│   ├── errors.controller.ts    ← one job: accept request, call service
│   ├── errors.service.ts       ← hot path: hash + Redis INCR + enqueue
│   ├── errors.processor.ts     ← async worker: INSERT IGNORE
│   ├── errors.repository.ts    ← DB layer with timing metrics
│   ├── errors.cron.ts          ← Redis → MySQL count sync every 30s
│   └── dto/log-error.dto.ts
├── shared/
│   ├── decorators/inject-redis.decorator.ts
│   └── metrics/metrics.module.ts
├── entities/error.entity.ts
├── app.module.ts
└── main.ts

docker/
├── docker-compose.yml
├── prometheus/prometheus.yml
└── grafana/dashboards/app-overview.json
```

***

## Observability

Every layer has its own Prometheus histogram. During a k6 run, Grafana shows all of them on the same timeline.

```mermaid
flowchart LR
    subgraph App["App Metrics"]
        M1[http_request_duration_seconds]
        M2[redis_operation_duration_seconds]
        M3[mysql_operation_duration_seconds]
        M4[nodejs_eventloop_lag_seconds]
    end

    subgraph Infra["Container Metrics — cAdvisor"]
        C1[container_memory_usage_bytes]
        C2[container_cpu_usage_seconds_total]
    end

    subgraph K6["k6 Metrics"]
        K1[k6_http_req_duration]
        K2[k6_vus]
        K3[k6_http_req_failed]
    end

    Prometheus --> Grafana

    App --> Prometheus
    Infra --> Prometheus
    K6 -->|remote write| Prometheus
```

### How to read Grafana during a load test

```mermaid
flowchart TD
    Start([k6 running]) --> L1{p95 climbing?}
    L1 -->|no| OK([✅ healthy at this load])
    L1 -->|yes| L2{Event Loop Lag high?}
    L2 -->|yes| Fix2[Node is blocked\nfind sync code in async path]
    L2 -->|no| L3{Redis latency spike?}
    L3 -->|yes| Fix3[Redis bottleneck\ncheck memory + ops/sec]
    L3 -->|no| L4{MySQL latency spike?}
    L4 -->|yes| Fix4[MySQL bottleneck\ncheck pool + slow queries]
    L4 -->|no| L5{Memory % near 80%?}
    L5 -->|yes| Fix5[Memory pressure\ncheck for leaks or increase limit]
    L5 -->|no| OK2([Increase load and repeat])

    style OK fill:#27ae60,color:#fff,stroke:none
    style OK2 fill:#27ae60,color:#fff,stroke:none
    style Fix2 fill:#c0392b,color:#fff,stroke:none
    style Fix3 fill:#c0392b,color:#fff,stroke:none
    style Fix4 fill:#c0392b,color:#fff,stroke:none
    style Fix5 fill:#c0392b,color:#fff,stroke:none
```

***

## Load Test Results

Same k6 script. Same hardware. Two architectures.

| VUs | Repo 1 (sync) | Repo 2 (async) |
|---|---|---|
| 10 | ~20ms, 0% errors | ~3ms, 0% errors |
| 50 | ~80ms, 0% errors | ~4ms, 0% errors |
| 100 | ~300ms, 2% errors | ~5ms, 0% errors |
| 200 | ~800ms, 15% errors | ~6ms, 0% errors |
| 500 | ~1800ms, 60% errors | ~8ms, 0% errors |

The gap is not from better hardware. It is from removing MySQL from the request path.

***

## Running the Tests

```bash
# Start full stack (app + mysql + redis + prometheus + grafana + cadvisor)
docker compose up -d

# Gradual ramp  0 → 50 → 200 → 500 VUs
k6 run -o experimental-prometheus-rw load-test.js

# Sudden spike to 1000 VUs
k6 run --env SCENARIO=spike -o experimental-prometheus-rw load-test.js

# 30 min soak — watch for memory leaks + Redis key growth
k6 run --env SCENARIO=soak -o experimental-prometheus-rw load-test.js
```

| Dashboard | URL |
|---|---|
| Grafana | http://localhost:3000 |
| Prometheus | http://localhost:9090 |
| App health | http://localhost:9002/health |
| App metrics | http://localhost:9002/metrics |

***

## Container Memory Limit Experiment

The backend container is capped at **1 GB** in `docker-compose.yml`.

During the soak test, watch the **Memory % Used** gauge in Grafana. Normal load stays around 20–30%. A memory leak shows as a steady climb toward 80–90% over 30 minutes.

```promql
100 * container_memory_usage_bytes{container_label_com_docker_compose_service="backend",image!=""}
    / container_spec_memory_limit_bytes{container_label_com_docker_compose_service="backend",image!=""}
```

***

## Known Limits of This Design

| Limit | Impact | What comes next |
|---|---|---|
| Redis is a single point of failure | Queue + counters fail together | Redis Sentinel / Cluster |
| Queue depth is unbounded | Worker lag under sustained spike | `maxSize` + Dead Letter Queue |
| Redis key count grows with unique errors | Memory pressure over time | TTL on keys + archive to cold storage |

***

## What This Taught Me

Async architecture is not about making the code more complex. It is about deciding which parts of the system need to be fast (the API response) and which parts just need to eventually be correct (the DB write). Once that boundary is clear, the design follows naturally.

***

## See Where It Started

👉 **[error-logger-naive-to-production](https://github.com/yourusername/error-logger-naive-to-production)**

The synchronous version. No queue, no Redis, one table. Worth reading first.
