import { createHash } from 'node:crypto';

// Diagnóstico sin exponer secretos: huella corta (SHA-256) de una contraseña,
// suficiente para comparar si dos valores son iguales, inútil para adivinarla.
export const fingerprint = (secret) => createHash('sha256').update(secret).digest('hex').slice(0, 8);

/** "usuario@servidor/base (huella xxxxxxxx)" de una URL de conexión, sin la contraseña. */
export function describeDbUrl(raw) {
  try {
    const u = new URL(raw);
    const pass = decodeURIComponent(u.password);
    return `${decodeURIComponent(u.username)}@${u.hostname}${u.pathname}${pass ? ` (huella ${fingerprint(pass)})` : ''}`;
  } catch {
    return 'URL de conexión inválida (debe empezar por postgresql://)';
  }
}
