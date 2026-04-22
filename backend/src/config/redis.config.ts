// src/config/redis.config.ts
import { ConfigService } from '@nestjs/config';

export interface RedisConfig {
  host: string | undefined;
  port: number;
}

export const getRedisConfig = (config?: ConfigService): RedisConfig => ({
  host: config?.get('REDIS_HOST') ? process.env.REDIS_HOST : 'localhost',
  port: config?.get<number>('REDIS_PORT')
    ? Number(process.env.REDIS_PORT)
    : 6379,
});
