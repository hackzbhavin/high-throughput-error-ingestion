import { createHash } from 'node:crypto';
import { AppDataSource } from './data-source';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const TOTAL = 10_000;// distinct error fingerprints to seed
const CHUNK_SIZE = 500;
const CONCURRENCY_LIMIT = 20;

// ---------------------------------------------------------------------------
// Realistic-looking error pool (message templates)
// ---------------------------------------------------------------------------
const ERROR_TEMPLATES = [
  'TypeError: Cannot read properties of undefined (reading "{prop}")',
  'ReferenceError: {name} is not defined',
  'SyntaxError: Unexpected token "{token}" in JSON at position {pos}',
  'RangeError: Maximum call stack size exceeded in {fn}',
  'Error: connect ECONNREFUSED {host}:{port}',
  'Error: ETIMEDOUT — request to {host} timed out after {ms}ms',
  'Error: ER_DUP_ENTRY: Duplicate entry "{val}" for key "{key}"',
  'Error: ER_NO_SUCH_TABLE: Table "{db}.{table}" doesn\'t exist',
  'UnhandledPromiseRejectionWarning: Error: {msg}',
  'Error: ENOENT: no such file or directory, open "{path}"',
  'Error: Cannot find module "{module}"',
  'Error: JWT expired at {ts}',
  'Error: invalid signature for JWT token',
  'Error: Redis connection lost — retrying in {ms}ms',
  'Error: BullMQ worker crashed — queue "{queue}" stalled',
  'HttpException: 502 Bad Gateway — upstream {host}',
  'HttpException: 429 Too Many Requests — rate limit hit for {key}',
  'Error: MySQL: ER_LOCK_DEADLOCK — try restarting transaction',
  'Error: S3: NoSuchKey — The specified key "{key}" does not exist',
  'Error: PayloadTooLargeError — request body exceeds {size}kb',
];

const STACK_TRACE_TEMPLATE = `Error: {message}
    at {fn} ({file}.ts:{line}:{col})
    at processTicksAndRejections (node:internal/process/task_queues:95:5)
    at async {module}.{method} ({file}.service.ts:{line2}:{col2})`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function rand(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

function interpolate(template: string): string {
  return template
    .replace('{prop}', rand(['id', 'name', 'data', 'user', 'token', 'config']))
    .replace('{name}', rand(['userId', 'orderId', 'req', 'res', 'next']))
    .replace('{token}', rand(['<', '>', '{', '}', 'null']))
    .replace('{pos}', String(Math.floor(Math.random() * 200)))
    .replace('{fn}', rand(['processQueue', 'handleRequest', 'buildPayload', 'syncErrors']))
    .replace('{host}', rand(['localhost', '10.0.0.1', 'redis.internal', 'db.internal']))
    .replace('{port}', rand(['3306', '6379', '5432', '9200']))
    .replace('{ms}', String(Math.floor(Math.random() * 10000)))
    .replace('{val}', rand(['user@test.com', '42', 'abc-123']))
    .replace('{key}', rand(['PRIMARY', 'uq_email', 'uq_fingerprint']))
    .replace('{db}', rand(['high_throughput_error_ingestion', 'myapp']))
    .replace('{table}', rand(['orders', 'payments', 'sessions']))
    .replace('{msg}', rand(['connection refused', 'timeout exceeded', 'not found']))
    .replace('{path}', rand(['/etc/config.json', '/tmp/upload.bin', '/app/.env']))
    .replace('{module}', rand(['./auth/auth.service', './queue/processor', './db/repo']))
    .replace('{ts}', new Date(Date.now() - Math.random() * 1e9).toISOString())
    .replace('{queue}', rand(['error-queue', 'email-queue', 'export-queue']))
    .replace('{size}', String(Math.floor(Math.random() * 1000 + 100)))
    .replace('{file}', rand(['app', 'users', 'errors', 'auth', 'queue']))
    .replace('{line}', String(Math.floor(Math.random() * 500 + 1)))
    .replace('{col}', String(Math.floor(Math.random() * 80 + 1)))
    .replace('{module}', rand(['ErrorsService', 'AuthService', 'QueueProcessor']))
    .replace('{method}', rand(['log', 'create', 'find', 'process']))
    .replace('{line2}', String(Math.floor(Math.random() * 500 + 1)))
    .replace('{col2}', String(Math.floor(Math.random() * 80 + 1)));
}

function makeError(i: number): { message: string; stackTrace: string; fingerprint: string; count: number } {
  // ~30% of errors are repeated (same fingerprint) to simulate deduplication
  const templateIndex = i % ERROR_TEMPLATES.length;
  const message = interpolate(ERROR_TEMPLATES[templateIndex]);
  const fingerprint = createHash('sha256').update(message).digest('hex').slice(0, 64);
  const stackTrace = interpolate(STACK_TRACE_TEMPLATE.replace('{message}', message));
  const count = Math.floor(Math.random() * 500) + 1;
  return { message, stackTrace, fingerprint, count };
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
async function seed() {
  await AppDataSource.initialize();
  console.log('Connected to database');

  try {
    console.log('Truncating errors table...');
    await AppDataSource.query('TRUNCATE TABLE errors');

    console.log(`Seeding ${TOTAL} error records...`);

    let start = 0;

    while (start < TOTAL) {
      const promises: Promise<any>[] = [];

      for (let i = 0; i < CONCURRENCY_LIMIT && start < TOTAL; i++) {
        const end = Math.min(start + CHUNK_SIZE, TOTAL);
        const placeholders: string[] = [];
        const params: (string | number)[] = [];

        for (let j = start; j < end; j++) {
          const { message, stackTrace, fingerprint, count } = makeError(j);
          placeholders.push('(?, ?, ?, ?, NOW(), NOW())');
          params.push(message, stackTrace, fingerprint, count);
        }

        promises.push(
          AppDataSource.query(
            `INSERT IGNORE INTO errors (message, stackTrace, fingerprint, count, createdAt, lastSeenAt) VALUES ${placeholders.join(', ')}`,
            params,
          ),
        );

        start += CHUNK_SIZE;
      }

      await Promise.all(promises);

      process.stdout.write(`\rSeeded up to ${Math.min(start, TOTAL)}/${TOTAL} errors...`);
    }

    console.log(`\nDone — ${TOTAL} error records inserted.`);
  } catch (err) {
    console.error('\nSeed failed:', err);
    process.exit(1);
  } finally {
    await AppDataSource.destroy();
  }
}

seed();
