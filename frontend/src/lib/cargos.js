// Cargos del personal clínico (ver backend/src/lib/cargos.js). El rol define
// permisos; el cargo define qué servicios ejecuta cada persona.
export const CARGOS_COLABORADOR = ['Odontólogo', 'Higienista', 'Auxiliar', 'Especialista'];
export const CARGOS = [...CARGOS_COLABORADOR, 'Asistente'];

// Opciones del selector "Rol" al crear/editar usuarios: los colaboradores se
// eligen directamente por su cargo.
export const PUESTOS = [
  ...CARGOS_COLABORADOR.map((c) => ({ value: `Colaborador:${c}`, label: c, role: 'Colaborador', cargo: c })),
  { value: 'Asistente', label: 'Asistente', role: 'Asistente', cargo: null },
  { value: 'Gerente', label: 'Gerente', role: 'Gerente', cargo: null },
  { value: 'Super Admin', label: 'Super Admin', role: 'Super Admin', cargo: null },
];
export const puestoDe = (u) => (u.role === 'Colaborador' && u.cargo ? `Colaborador:${u.cargo}` : u.role);
export const etiquetaPuesto = (u) => (u.role === 'Colaborador' && u.cargo ? u.cargo : u.role);
