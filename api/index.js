// Función de Vercel: la API Express completa en el mismo dominio que el frontend
// (necesario para las cookies SameSite=Strict). vercel.json reescribe /api/* aquí
// y Express conserva la ruta original (/api/...).
import { createApp } from '../backend/src/app.js';
import { db } from '../backend/src/db.js';

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
    console.error(`[api] ${err.message}`);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Servicio no disponible' } }));
  }
  return app(req, res);
}
