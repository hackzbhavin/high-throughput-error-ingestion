import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import Redis from 'ioredis';
import { InjectRedis } from '../../../shared/decorators/inject-redis.decorator.js';
import { ErrorsRepository } from '../errors.repository.js';
import { REDIS_KEY_PREFIX } from '../utils/constants.js';

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Step 7-8: Cron — fetch all err:* keys from Redis → batch UPSERT counts to MySQL
@Injectable()
export class ErrorSyncScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ErrorSyncScheduler.name);
  private timer: NodeJS.Timeout;

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly errorsRepo: ErrorsRepository,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => this.sync(), SYNC_INTERVAL_MS);
    this.logger.log(
      `Error sync scheduler started (every ${SYNC_INTERVAL_MS / 1000}s)`,
    );
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  async sync(): Promise<void> {
    this.logger.log('Running error count sync...');

    // Step 7: fetch all err:* keys
    const keys = await this.redis.keys(REDIS_KEY_PREFIX + ':*');
    console.log('Keys', keys);
    if (!keys.length) return;

    // Step 8: for each key, get count and UPSERT into MySQL
    for (const key of keys) {
      const count = parseInt((await this.redis.get(key)) ?? '0', 10);
      if (!count) continue;

      const fingerprint = key.replace(REDIS_KEY_PREFIX + ':', '');
      await this.errorsRepo.upsertCount(fingerprint, count);
    }

    this.logger.log(`Synced ${keys.length} error fingerprints to MySQL`);
  }
}
