import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ErrorEvent } from '../../entities/error.entity.js';
import { ErrorsController } from './errors.controller.js';
import { ErrorsRepository } from './errors.repository.js';
import { ErrorsService } from './errors.service.js';
import { ErrorProcessor } from './processors/error.processor.js';
import { ErrorSyncScheduler } from './schedulers/error-sync.scheduler.js';
import { ERROR_QUEUE } from './utils/constants.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([ErrorEvent]),
    BullModule.registerQueue({ name: ERROR_QUEUE }),
  ],
  controllers: [ErrorsController],
  providers: [
    ErrorsService,
    ErrorsRepository,
    ErrorProcessor,
    ErrorSyncScheduler,
  ],
})
export class ErrorsModule {}
