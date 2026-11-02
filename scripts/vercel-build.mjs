// Build de Vercel: migraciones (solo en producción) + frontend.
// Las vistas previas (preview) no tocan la base de datos de producción.
import { execSync } from 'node:child_process';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

if (process.env.VERCEL_ENV === 'production') {
  console.log('[vercel-build] aplicando migraciones…');
  run('node backend/scripts/migrate.js');
} else {
  console.log(`[vercel-build] entorno ${process.env.VERCEL_ENV ?? 'local'}: sin migraciones`);
}
run('npm --prefix frontend run build');
