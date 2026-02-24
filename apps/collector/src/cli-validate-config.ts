import { loadValidatedConfig } from './config.js';

async function main(): Promise<void> {
  try {
    const config = await loadValidatedConfig();
    console.log(`Config valid: ${config.project.name}`);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}

void main();
