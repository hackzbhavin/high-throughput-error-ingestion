import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ErrorsRepository } from '../errors.repository.js';
import { ERROR_QUEUE } from '../utils/constants.js';

interface ErrorJobData {
  message: string;
  stackTrace: string | null;
  fingerprint: string;
}

// Step 5-6: Worker process — INSERT only on first occurrence (INSERT IGNORE)
@Processor(ERROR_QUEUE)
export class ErrorProcessor extends WorkerHost {
  private readonly logger = new Logger(ErrorProcessor.name);

  constructor(private readonly errorsRepo: ErrorsRepository) {
    super();
  }

  async process(job: Job<ErrorJobData>): Promise<void> {
    const { message, stackTrace, fingerprint } = job.data;

    await this.errorsRepo.insertIfNew({
      message,
      stackTrace: stackTrace ?? undefined,
      fingerprint,
    });

    this.logger.debug(`Processed job ${job.id} for fingerprint ${fingerprint}`);
  }
}
