// Cargos del personal clínico (migración 008). El rol define permisos; el
// cargo define qué servicios ejecuta cada persona.
export const CARGOS_COLABORADOR = Object.freeze(['Odontólogo', 'Higienista', 'Auxiliar', 'Especialista']);
export const CARGO_ASISTENTE = 'Asistente';
export const CARGOS = Object.freeze([...CARGOS_COLABORADOR, CARGO_ASISTENTE]);
// Roles cuyos usuarios ejecutan servicios (aparecen como colaboradores).
export const ROLES_EJECUTAN = Object.freeze(['Colaborador', 'Asistente']);
