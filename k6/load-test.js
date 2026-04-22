/**
 * k6 Load Test — smart-error-deduplication
 *
 * Tests the full pipeline:
 *   POST /api/v1/errors/log → redis.incr → BullMQ → worker INSERT → cron UPSERT
 *
 * Usage (metrics go to Grafana via Prometheus remote write):
 *   k6 run -o experimental-prometheus-rw load-test.js           # default ramp
 *   k6 run -o experimental-prometheus-rw --env SCENARIO=spike load-test.js
 *   k6 run -o experimental-prometheus-rw --env SCENARIO=soak  load-test.js
 *   k6 run --env BASE_URL=http://prod:9002 load-test.js         # no metrics output
 *
 * Prometheus remote write endpoint (default): http://localhost:9090/api/v1/write
 * Override: K6_PROMETHEUS_RW_SERVER_URL=http://your-host:9090/api/v1/write
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const BASE_URL = __ENV.BASE_URL || 'http://localhost:9002';
const ENDPOINT = `${BASE_URL}/api/v1/errors/log`;
const SCENARIO = __ENV.SCENARIO || 'ramp';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------
const errorRate    = new Rate('error_rate');
const p99Latency   = new Trend('p99_latency', true);
const dedupHits    = new Counter('dedup_hits');   // 429 / duplicate-fingerprint responses
const queuedCount  = new Counter('queued_count'); // successful 200s

// ---------------------------------------------------------------------------
// Scenario definitions
// ---------------------------------------------------------------------------
const SCENARIOS = {
  // Gradual ramp — baseline health check
  ramp: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '30s', target: 50  },
      { duration: '1m',  target: 200 },
      { duration: '30s', target: 500 },
      { duration: '1m',  target: 500 },
      { duration: '30s', target: 0   },
    ],
  },

  // Spike — sudden burst to simulate real traffic spikes
  spike: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '10s', target: 10   },
      { duration: '10s', target: 1000 }, // spike
      { duration: '30s', target: 1000 },
      { duration: '10s', target: 10   },
      { duration: '10s', target: 0    },
    ],
  },

  // Soak — sustained load to catch memory leaks or Redis key buildup
  soak: {
    executor: 'constant-vus',
    vus: 100,
    duration: '30m',
  },
};

export const options = {
  scenarios: {
    load: SCENARIOS[SCENARIO] || SCENARIOS.ramp,
  },
  thresholds: {
    http_req_duration: ['p(95)<200', 'p(99)<500'], // 95% under 200ms, 99% under 500ms
    error_rate:        ['rate<0.01'],               // less than 1% errors
    http_req_failed:   ['rate<0.01'],
  },
};

// ---------------------------------------------------------------------------
// Error payload pool — mix of unique + repeated errors to test dedup
// ---------------------------------------------------------------------------
const ERROR_POOL = [
  // High-frequency repeated errors (same fingerprint → dedup should kick in)
  {
    message: 'TypeError: Cannot read properties of undefined (reading "id")',
    stackTrace: `TypeError: Cannot read properties of undefined (reading "id")\n    at ErrorsService.log (errors.service.ts:22:18)\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)`,
  },
  {
    message: 'Error: connect ECONNREFUSED 127.0.0.1:3306',
    stackTrace: `Error: connect ECONNREFUSED 127.0.0.1:3306\n    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1494:16)`,
  },
  {
    message: 'Error: JWT expired at 2024-01-01T00:00:00.000Z',
    stackTrace: `JsonWebTokenError: jwt expired\n    at /app/node_modules/jsonwebtoken/verify.js:89:21`,
  },
  {
    message: 'Error: Redis connection lost — retrying in 5000ms',
    stackTrace: `Error: Redis connection lost\n    at RedisClient._stream.on (ioredis/built/redis/index.js:201:18)`,
  },
  {
    message: 'UnhandledPromiseRejectionWarning: Error: connection refused',
    stackTrace: `UnhandledPromiseRejectionWarning: Error: connection refused\n    at QueueProcessor.process (error.processor.ts:18:5)`,
  },
];

// Unique error generator — every VU iteration produces a distinct fingerprint
let _counter = 0;
function uniqueError() {
  _counter++;
  return {
    message: `Error: unique runtime failure #${_counter} in worker-${__VU}`,
    stackTrace: `Error: unique runtime failure\n    at Worker.run (worker.ts:${_counter % 300}:12)\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)`,
  };
}

// ---------------------------------------------------------------------------
// Main VU function
// ---------------------------------------------------------------------------
export default function () {
  // 70% repeated errors (tests dedup path), 30% unique (tests first-insert path)
  const payload = Math.random() < 0.7
    ? ERROR_POOL[Math.floor(Math.random() * ERROR_POOL.length)]
    : uniqueError();

  const res = http.post(
    ENDPOINT,
    JSON.stringify(payload),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'log_error' },
    },
  );

  // Track custom metrics
  p99Latency.add(res.timings.duration);
  errorRate.add(res.status >= 500);

  if (res.status === 200) {
    queuedCount.add(1);
  } else if (res.status === 429) {
    dedupHits.add(1);
  }

  check(res, {
    'status is 200':        (r) => r.status === 200,
    'response has status':  (r) => JSON.parse(r.body)?.data?.status === 'queued',
    'latency < 200ms':      (r) => r.timings.duration < 200,
  });

  sleep(0.1); // 100ms think time → ~10 RPS per VU
}

// ---------------------------------------------------------------------------
// Summary output
// ---------------------------------------------------------------------------
export function handleSummary(data) {
  const reqs    = data.metrics.http_reqs?.values?.count ?? 0;
  const p95     = data.metrics.http_req_duration?.values?.['p(95)']?.toFixed(2) ?? '-';
  const p99     = data.metrics.http_req_duration?.values?.['p(99)']?.toFixed(2) ?? '-';
  const errRate = ((data.metrics.error_rate?.values?.rate ?? 0) * 100).toFixed(2);
  const queued  = data.metrics.queued_count?.values?.count ?? 0;

  console.log('\n========== Load Test Summary ==========');
  console.log(`Total requests : ${reqs}`);
  console.log(`Queued (200)   : ${queued}`);
  console.log(`p95 latency    : ${p95}ms`);
  console.log(`p99 latency    : ${p99}ms`);
  console.log(`Error rate     : ${errRate}%`);
  console.log('=======================================\n');

  return {
    stdout: '',
    'k6/results.json': JSON.stringify(data, null, 2),
  };
}
