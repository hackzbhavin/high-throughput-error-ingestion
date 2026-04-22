import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateErrorsTable1713000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE errors (
        id INT NOT NULL AUTO_INCREMENT,
        message VARCHAR(500) NOT NULL,
        stackTrace TEXT,
        fingerprint VARCHAR(64) NOT NULL,
        count INT NOT NULL DEFAULT 1,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        lastSeenAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_fingerprint (fingerprint)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE errors`);
  }
}
