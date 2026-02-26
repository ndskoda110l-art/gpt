import app from './app.js';
import { config } from './config.js';
import { closePool } from './db.js';

const server = app.listen(config.appPort, () => {
  console.log(`SMS gateway API listening on port ${config.appPort}`);
});

const shutdown = async () => {
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
