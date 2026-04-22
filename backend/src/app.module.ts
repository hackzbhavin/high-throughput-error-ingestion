import { BullModule } from '@nestjs/bullmq';
import { MiddlewareConsumer, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { ErrorsModule } from './modules/errors/errors.module.js';
import { HealthModule } from './shared/health/health.module.js';
import { RedisModule } from './shared/redis.module.js';
import { MetricsModule } from './shared/metrics/metrics.module.js';
import { ResponseTimeMiddleware } from './shared/middleware/response-time.middleware.js';
import { getTypeOrmConfig } from './config/typeorm.config.js';
import { getRedisConfig } from './config/redis.config.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrometheusModule.register(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: () => getTypeOrmConfig(),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: getRedisConfig(config),
      }),
    }),
    RedisModule,
    MetricsModule,
    ErrorsModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ResponseTimeMiddleware).forRoutes('*');
  }
}
