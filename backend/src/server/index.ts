import { buildApp } from './app.js';
import { config } from '../config/index.js';
import { databaseClient } from '../database/client.js';

async function main(): Promise<void> {
  const app = await buildApp();

  // Graceful shutdown handler
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}. Gracefully closing closeVDS backend...`);
      try {
        await app.close();
        app.log.info('closeVDS backend closed successfully.');
        process.exit(0);
      } catch (err) {
        app.log.error({ err }, 'Error during graceful backend shutdown');
        process.exit(1);
      }
    });
  }

  try {
    const address = await app.listen({
      port: config.PORT,
      host: config.HOST,
    });
    app.log.info(`closeVDS Backend API running on ${address}`);
    app.log.info(`Health check available at ${address}/health and ${address}/api/v1/health`);

    // Non-blocking initial database health visibility check
    try {
      await databaseClient.connect();
      const dbHealth = await databaseClient.healthCheck();
      if (dbHealth.ready) {
        app.log.info(`[Startup] Database connection verified (${dbHealth.status}, latency: ${dbHealth.latencyMs ?? 0}ms)`);
      } else {
        app.log.warn(`[Startup] Database initial check: ${dbHealth.message} (${dbHealth.status})`);
      }
    } catch (dbErr) {
      app.log.warn({ err: dbErr }, '[Startup] Database initial connectivity check failed (non-blocking)');
    }
  } catch (err) {
    app.log.error({ err }, 'Fatal error during backend server startup');
    process.exit(1);
  }
}

// Start application if executed directly
if (process.env.NODE_ENV !== 'test') {
  main().catch((err) => {
    console.error('Unhandled bootstrap error:', err);
    process.exit(1);
  });
}
