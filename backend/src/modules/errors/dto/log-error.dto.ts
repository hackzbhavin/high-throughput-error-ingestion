import { IsOptional, IsString, MaxLength } from 'class-validator';

export class LogErrorDto {
  @IsString()
  @MaxLength(500)
  message!: string;

  @IsString()
  @IsOptional()
  stackTrace?: string;
}
