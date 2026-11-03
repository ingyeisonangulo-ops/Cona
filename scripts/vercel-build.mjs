// Build de Vercel: migraciones (solo en producción) + frontend.
// Las vistas previas (preview) no tocan la base de datos de producción.
import { spawnSync } from 'node:child_process';

// Ejecuta un paso; si falla, la ÚLTIMA línea del registro dice el motivo
// (sin el volcado de pila de Node, que ocultaba la causa real).
function run(label, cmd, args, { shell = false } = {}) {
  const r = spawnSync(cmd, args, { stdio: ['inherit', 'inherit', 'pipe'], encoding: 'utf8', shell });
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    const motivo = r.stderr?.split(/\r?\n/).filter((l) => l.trim()).findLast((l) => l.includes('[migrate]')) ?? r.stderr?.trim().split(/\r?\n/).pop();
    console.error(`\n[vercel-build] FALLÓ ${label}: ${motivo || `código ${r.status}`}`);
    process.exit(1);
  }
}

if (process.env.VERCEL_ENV === 'production') {
  console.log('[vercel-build] aplicando migraciones…');
  run('la migración', process.execPath, ['backend/scripts/migrate.js']);
} else {
  console.log(`[vercel-build] entorno ${process.env.VERCEL_ENV ?? 'local'}: sin migraciones`);
}
// npm es un script .cmd en Windows: necesita shell (en Vercel, Linux, da igual).
run('la compilación del frontend', 'npm', ['--prefix', 'frontend', 'run', 'build'], { shell: process.platform === 'win32' });
