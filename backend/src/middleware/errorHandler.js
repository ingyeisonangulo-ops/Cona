import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';

// Traducción de errores de PostgreSQL a respuestas sin detalles internos.
const PG_ERRORS = {
  23505: [409, 'Ya existe un registro con ese nombre', 'DUPLICATE'],
  23503: [400, 'Referencia inválida', 'INVALID_REFERENCE'],
  23514: [400, 'Datos fuera de las reglas permitidas', 'CHECK_VIOLATION'],
  '22P02': [400, 'Formato de dato inválido', 'INVALID_FORMAT'],
  // Violación de RLS / guardas: no se revela la existencia del registro.
  42501: [404, 'Recurso no encontrado', 'NOT_FOUND'],
};

export function notFoundApi(_req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Recurso no encontrado' } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Cuerpo de solicitud inválido' } });
  }
  const mapped = err?.code && PG_ERRORS[err.code];
  if (mapped) {
    const [status, message, code] = mapped;
    return res.status(status).json({ error: { code, message } });
  }
  console.error(`[error] ${req.method} ${req.originalUrl}:`, config.isProd ? err?.message : err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Error interno del servidor' } });
}
