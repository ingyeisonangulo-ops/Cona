import { createApp } from './app.js';
import { config } from './config.js';
import { db } from './db.js';

async function main() {
  const role = await db.assertRestrictedRole();
  const server = createApp().listen(config.port, () => {
    console.log(`[server] escuchando en :${config.port} (${config.env}) — rol BD: ${role}`);
  });

  const shutdown = (signal) => {
    console.log(`[server] ${signal}: cerrando`);
    server.close(() => db.close().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(`[server] no se pudo iniciar: ${err.message}`);
  process.exit(1);
});
