import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('errors')
export class ErrorEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 500 })
  message: string;

  @Column({ type: 'text', nullable: true })
  stackTrace: string | null;

  @Column({ length: 64, unique: true })
  fingerprint: string;

  @Column({ default: 1 })
  count: number;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  lastSeenAt: Date;
}
