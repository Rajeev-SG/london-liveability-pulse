import 'dotenv/config';

import { collectOnce } from './collect.js';

async function main(): Promise<void> {
  try {
    const result = await collectOnce();
    console.log(`Collected snapshot -> ${result.outDir}`);
    console.log(`Score: ${result.latest.liveabilityScore}`);
    if (result.latest.warnings.length > 0) {
      console.warn(`Warnings: ${result.latest.warnings.join(' | ')}`);
    }
  } catch (error) {
    console.error(`Collector failed: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

void main();
