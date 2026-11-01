import { readFileSync } from 'node:fs';

// matrix.json es la fuente única de verdad de permisos por rol.
const matrix = JSON.parse(readFileSync(new URL('../../matrix.json', import.meta.url), 'utf8'));

export const ALL = 'ALL';
export const ROLES = Object.freeze(Object.keys(matrix));

export const ALL_PERMISSIONS = Object.freeze(
  [...new Set(Object.values(matrix).flat())].filter((p) => p !== ALL).sort(),
);

export function isValidRole(role) {
  return Object.hasOwn(matrix, role);
}

// Deniega por defecto: un rol desconocido no tiene permisos.
export function hasPermission(role, permission) {
  if (!isValidRole(role)) return false;
  const granted = matrix[role];
  return granted.includes(ALL) || granted.includes(permission);
}

export function permissionsFor(role) {
  if (!isValidRole(role)) return [];
  const granted = matrix[role];
  return granted.includes(ALL) ? [...ALL_PERMISSIONS] : [...granted];
}

export const SUPER_ADMIN = 'Super Admin';
