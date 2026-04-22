import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { NextFunction, Request, Response } from 'express';
import { Counter, Gauge, Histogram } from 'prom-client';
import {
  METRIC_HTTP_IN_FLIGHT,
  METRIC_HTTP_REQUEST_DURATION,
  METRIC_HTTP_REQUESTS_TOTAL,
} from '../metrics/metrics.module.js';

@Injectable()
export class ResponseTimeMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  constructor(
    @InjectMetric(METRIC_HTTP_REQUEST_DURATION) private readonly histogram: Histogram<string>,
    @InjectMetric(METRIC_HTTP_REQUESTS_TOTAL) private readonly counter: Counter<string>,
    @InjectMetric(METRIC_HTTP_IN_FLIGHT) private readonly inFlight: Gauge<string>,
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    const { method } = req;
    const endTimer = this.histogram.startTimer({ method });
    this.inFlight.inc();

    res.on('finish', () => {
      const route = (req.route?.path ?? req.path) as string;
      const status_code = String(res.statusCode);

      endTimer({ route, status_code });
      this.counter.inc({ method, route, status_code });
      this.inFlight.dec();

      const duration = res.getHeader('X-Response-Time') ?? `${Date.now()}ms`;
      this.logger.log(`${method} ${req.originalUrl} ${res.statusCode} - ${duration}`);
    });

    next();
  }
}
