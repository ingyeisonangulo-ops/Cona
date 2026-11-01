import { config } from '../config.js';
import { forbidden } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Defensa CSRF adicional a SameSite=Strict: toda petición que modifica estado
// debe venir del origen exacto de la aplicación.
export function originGuard(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin !== config.appOrigin) return next(forbidden('Origen no permitido', 'BAD_ORIGIN'));
  next();
}

// Las respuestas de la API nunca deben quedar en cachés HTTP intermedias.
export function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  next();
}
