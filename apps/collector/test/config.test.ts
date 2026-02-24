import { describe, expect, it } from 'vitest';

import { validateConfigObject } from '../src/config.js';
import { makeValidConfig } from './helpers.js';

describe('config validation', () => {
  it('accepts a valid config object', async () => {
    await expect(validateConfigObject(makeValidConfig())).resolves.toBeTruthy();
  });

  it('rejects if all sources are disabled', async () => {
    const config = makeValidConfig();
    config.sources.tfl.enabled = false;
    config.sources.openMeteo.enabled = false;
    config.sources.ergAirQuality.enabled = false;
    config.sources.fhrs.enabled = false;

    await expect(validateConfigObject(config)).rejects.toThrow('at least 1 source');
  });

  it('rejects collection interval below 5 minutes', async () => {
    const config = makeValidConfig();
    config.project.collectionIntervalMinutes = 4;

    await expect(validateConfigObject(config)).rejects.toThrow('>= 5 minutes');
  });
});
