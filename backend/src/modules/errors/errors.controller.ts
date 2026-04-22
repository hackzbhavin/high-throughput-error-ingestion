import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { LogErrorDto } from './dto/log-error.dto.js';
import { ErrorsService } from './errors.service.js';

@Controller('errors')
export class ErrorsController {
  constructor(private readonly errorsService: ErrorsService) {}

  // Step 1: fast ingestion — returns 200 immediately
  @Post('log')
  @HttpCode(HttpStatus.OK)
  async log(@Body() dto: LogErrorDto): Promise<{ status: string }> {
    await this.errorsService.log(dto);
    return { status: 'queued' };
  }
}
