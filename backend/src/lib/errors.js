export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message = 'Solicitud inválida', code = 'BAD_REQUEST') =>
  new HttpError(400, message, code);
export const unauthorized = (message = 'No autenticado', code = 'UNAUTHENTICATED') =>
  new HttpError(401, message, code);
export const forbidden = (message = 'No autorizado', code = 'FORBIDDEN') =>
  new HttpError(403, message, code);
// Se usa también cuando el registro existe pero no pertenece al usuario:
// así no se revela su existencia.
export const notFound = (message = 'Recurso no encontrado', code = 'NOT_FOUND') =>
  new HttpError(404, message, code);
export const tooManyRequests = (message, code = 'LOCKED') => new HttpError(429, message, code);

// Capa 3 (pertenencia): si RLS o el filtro no devolvieron el registro, 404.
export function requireFound(row) {
  if (!row) throw notFound();
  return row;
}
