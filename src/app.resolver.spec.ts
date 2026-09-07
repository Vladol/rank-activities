import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { AppResolver } from './app.resolver';
import { AppService } from './app.service';

describe('AppResolver', () => {
  it('resolves the hello query through AppService', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [AppResolver, AppService],
    }).compile();

    expect(moduleRef.get(AppResolver).hello()).toBe('Hello World!');
  });
});
