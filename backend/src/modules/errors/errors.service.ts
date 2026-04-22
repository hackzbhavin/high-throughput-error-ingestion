import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { Histogram } from 'prom-client';
import { InjectRedis } from '../../shared/decorators/inject-redis.decorator.js';
import { METRIC_REDIS_DURATION } from '../../shared/metrics/metrics.module.js';
import { LogErrorDto } from './dto/log-error.dto.js';
import { ErrorsRepository } from './errors.repository.js';
import { ERROR_QUEUE, REDIS_KEY_PREFIX } from './utils/constants.js';



@Injectable()
export class ErrorsService {
  constructor(
    @InjectQueue(ERROR_QUEUE) private readonly errorQueue: Queue,
    @InjectRedis() private readonly redis: Redis,
    private readonly repos: ErrorsRepository,
    @InjectMetric(METRIC_REDIS_DURATION)
    private readonly redisHistogram: Histogram<string>,
  ) {}

  async log(dto: LogErrorDto): Promise<void> {
    const fingerprint = createHash('sha256')
      .update(dto.message)
      .digest('hex')
      .slice(0, 64);
    const redisKey = `${REDIS_KEY_PREFIX}:${fingerprint}`;

    // Step 2: increment counter in Redis (non-blocking)
    const endRedis = this.redisHistogram.startTimer({ operation: 'incr' });
    await this.redis.incr(redisKey);
    endRedis();

    // Step 3: enqueue job (non-blocking) — worker handles the INSERT
    await this.errorQueue.add('log-error', {
      message: dto.message,
      stackTrace: dto.stackTrace ?? null,
      fingerprint,
    });
  }
}
