import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('system')
@Controller('/health')
export class HealthController {
  @Get()
  ok() { return { ok: true }; }
}
