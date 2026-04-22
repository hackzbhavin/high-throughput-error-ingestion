import { Global, Module } from '@nestjs/common';
import {
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';

export const METRIC_HTTP_REQUEST_DURATION = 'http_request_duration_seconds';
export const METRIC_HTTP_REQUESTS_TOTAL = 'http_requests_total';
export const METRIC_HTTP_IN_FLIGHT = 'http_requests_in_flight';
export const METRIC_REDIS_DURATION = 'redis_operation_duration_seconds';
export const METRIC_MYSQL_DURATION = 'mysql_operation_duration_seconds';

const providers = [
  makeHistogramProvider({
    name: METRIC_HTTP_REQUEST_DURATION,
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  }),
  makeCounterProvider({
    name: METRIC_HTTP_REQUESTS_TOTAL,
    help: 'Total HTTP requests by method, route and status code',
    labelNames: ['method', 'route', 'status_code'],
  }),
  makeGaugeProvider({
    name: METRIC_HTTP_IN_FLIGHT,
    help: 'In-flight HTTP requests currently being processed',
  }),
  makeHistogramProvider({
    name: METRIC_REDIS_DURATION,
    help: 'Redis operation duration in seconds',
    labelNames: ['operation'],
    buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1],
  }),
  makeHistogramProvider({
    name: METRIC_MYSQL_DURATION,
    help: 'MySQL operation duration in seconds',
    labelNames: ['operation'],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  }),
];

@Global()
@Module({
  providers,
  exports: providers,
})
export class MetricsModule {}
