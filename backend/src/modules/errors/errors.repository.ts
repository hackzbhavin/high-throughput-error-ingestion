import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Histogram } from 'prom-client';
import { ErrorEvent } from '../../entities/error.entity.js';
import { METRIC_MYSQL_DURATION } from '../../shared/metrics/metrics.module.js';

@Injectable()
export class ErrorsRepository {
  constructor(
    @InjectRepository(ErrorEvent)
    private readonly repo: Repository<ErrorEvent>,
    @InjectMetric(METRIC_MYSQL_DURATION)
    private readonly mysqlHistogram: Histogram<string>,
  ) {}

  async insertIfNew(data: {
    message: string;
    stackTrace?: string;
    fingerprint: string;
  }): Promise<void> {
    const end = this.mysqlHistogram.startTimer({ operation: 'insert_if_new' });
    try {
      await this.repo
        .createQueryBuilder()
        .insert()
        .into(ErrorEvent)
        .values({ ...data, count: 1 })
        .orIgnore() // INSERT IGNORE — skip if fingerprint already exists
        .execute();
    } finally {
      end();
    }
  }

  async upsertCount(fingerprint: string, count: number): Promise<void> {
    const end = this.mysqlHistogram.startTimer({ operation: 'upsert_count' });
    try {
      await this.repo
        .createQueryBuilder()
        .update(ErrorEvent)
        .set({ count, lastSeenAt: new Date() })
        .where('fingerprint = :fingerprint', { fingerprint })
        .execute();
    } finally {
      end();
    }
  }
}
