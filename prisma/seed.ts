import { bootstrapDatabase } from '../src/bootstrap/seed.js';

async function main() {
  const result = await bootstrapDatabase({
    logger: console,
    createAdminIfMissingOnly: true,
  });

  console.log('[bootstrap] completed', result);
}

main()
  .catch((error) => {
    console.error('[bootstrap] failed', error);
    process.exit(1);
  });
