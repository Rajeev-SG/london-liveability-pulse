import { describe, expect, it } from 'vitest';

import { sanitizeUrlForLineage } from '../src/sources.js';

describe('lineage URL sanitization', () => {
  it('redacts app_key and common secret query params', () => {
    const sanitized = sanitizeUrlForLineage('https://api.tfl.gov.uk/line/mode/tube/status?app_key=abc123&foo=bar&token=secret');
    expect(sanitized).toContain('app_key=REDACTED');
    expect(sanitized).toContain('token=REDACTED');
    expect(sanitized).toContain('foo=bar');
    expect(sanitized).not.toContain('abc123');
    expect(sanitized).not.toContain('secret');
  });
});
