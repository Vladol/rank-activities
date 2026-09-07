import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  /** Used by the e2e smoke test and by external monitoring. */
  @Get()
  check(): { status: 'ok'; uptime: number } {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }
}
