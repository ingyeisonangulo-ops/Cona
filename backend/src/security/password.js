import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

export const BCRYPT_COST = 12;
export const PASSWORD_MIN_LENGTH = 12;
// bcrypt ignora lo que excede 72 bytes: se rechaza en lugar de truncar.
export const PASSWORD_MAX_BYTES = 72;

// Hash de una contraseña aleatoria: se compara contra él cuando la cuenta no
// existe, para que el tiempo de respuesta sea equivalente.
const DUMMY_HASH = bcrypt.hashSync(randomUUID(), BCRYPT_COST);

export function validatePasswordPolicy(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`;
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return `La contraseña no puede superar ${PASSWORD_MAX_BYTES} bytes`;
  }
  if (password.trim() !== password) {
    return 'La contraseña no puede iniciar ni terminar con espacios';
  }
  return null;
}

export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

// Siempre ejecuta una comparación bcrypt, exista o no el hash real.
export async function verifyPassword(password, hash) {
  const candidate = typeof password === 'string' ? password : '';
  const ok = await bcrypt.compare(candidate, hash ?? DUMMY_HASH);
  return Boolean(hash) && ok;
}
