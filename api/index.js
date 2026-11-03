// Función de Vercel: la API Express completa en el mismo dominio que el frontend
// (necesario para las cookies SameSite=Strict). vercel.json reescribe /api/* aquí
// y Express conserva la ruta original (/api/...).
import { createApp } from '../backend/src/app.js';
import { config } from '../backend/src/config.js';
import { db } from '../backend/src/db.js';
import { describeDbUrl } from '../backend/src/lib/dbTarget.js';

const app = createApp();

// Igual que server.js: se niega a atender si la conexión puede saltarse RLS.
// Se verifica una vez por instancia (arranque en frío).
let roleCheck;

export default async function handler(req, res) {
  try {
    roleCheck ??= db.assertRestrictedRole();
    await roleCheck;
  } catch (err) {
    roleCheck = undefined;
    // Servidor, usuario y huella de la contraseña (nunca la contraseña): se compara
    // con la línea "[migrate] crm_app: contraseña asignada (huella …)" del build.
    console.error(`[api] ${err.message} — conexión: ${describeDbUrl(config.db.url)}`);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    // Diagnóstico mínimo para quien despliega (sin servidor ni contraseña): código
    // de error de PostgreSQL (p. ej. 28P01 = contraseña inválida) y huella.
    const huella = describeDbUrl(config.db.url).match(/huella (\w+)/)?.[1] ?? null;
    return res.end(
      JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Servicio no disponible', diagnostico: { pg: err.code ?? null, huella } } }),
    );
  }
  return app(req, res);
}
