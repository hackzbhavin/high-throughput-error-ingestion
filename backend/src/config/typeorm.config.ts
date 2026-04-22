import 'dotenv/config'; //
import { DataSourceOptions } from 'typeorm';
import { ErrorEvent } from '../entities/error.entity';

export const getTypeOrmConfig = (): DataSourceOptions => ({
  type: 'mysql',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT) ? Number(process.env.DB_PORT) : 3306,
  username: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASS ?? '',
  database: process.env.DB_NAME ?? 'high_throughput_error_ingestion',
  entities: [ErrorEvent],
  migrations: ['dist/migrations/*.js'],
  synchronize: false,
  migrationsRun: false,
  poolSize: 30
  // logging: true,
});
