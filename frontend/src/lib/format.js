const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('es-CO');
const dateTime = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' });

export const formatCOP = (v) => (v == null ? '—' : cop.format(v));
export const formatNumber = (v) => (v == null ? '—' : num.format(v));
export const formatDateTime = (v) => (v ? dateTime.format(new Date(v)) : '—');

export const PERMISSION_LABELS = {
  VIEW_DASHBOARD_FINANCE: 'Ver tablero financiero',
  MANAGE_SERVICES: 'Gestionar catálogo de servicios',
  MANAGE_COLLABORATORS: 'Gestionar colaboradores',
  REGISTER_SERVICES: 'Registrar servicios prestados',
  SEARCH_PATIENTS: 'Buscar pacientes',
  VIEW_PATIENT_HISTORY: 'Ver historial de pacientes',
  MANAGE_APPOINTMENTS: 'Gestionar citas',
  CLOSE_ABSENCES: 'Cerrar inasistencias',
  VIEW_PERSONAL_PROGRESS: 'Ver progreso personal',
  VIEW_ROLE_SERVICES: 'Ver servicios del rol',
  VIEW_RECURRENCE_RATE: 'Ver tasa de recurrencia',
  VIEW_MONTHLY_APPOINTMENTS_COUNT: 'Ver citas del mes',
  VIEW_AUDIT_LOGS: 'Ver bitácora de auditoría',
  MANAGE_USERS: 'Gestionar usuarios',
};

export const ACTION_LABELS = {
  LOGIN_SUCCESS: 'Inicio de sesión',
  LOGIN_FAILED: 'Inicio de sesión fallido',
  LOGIN_BLOCKED: 'Intento con cuenta bloqueada',
  ACCOUNT_LOCKED: 'Cuenta bloqueada',
  IP_LOCKED: 'IP bloqueada',
  ACCOUNT_UNLOCKED: 'Cuenta desbloqueada',
  LOGOUT: 'Cierre de sesión',
  SESSIONS_REVOKED: 'Sesiones cerradas',
  REFRESH_TOKEN_REUSE: 'Reutilización de sesión detectada',
  PASSWORD_CHANGED: 'Cambio de contraseña',
  PASSWORD_RESET_REQUESTED: 'Solicitud de recuperación',
  PASSWORD_RESET_ISSUED: 'Enlace de restablecimiento emitido',
  PASSWORD_RESET_COMPLETED: 'Contraseña restablecida',
  USER_CREATED: 'Usuario creado',
  USER_UPDATED: 'Usuario editado',
  ROLE_CHANGED: 'Cambio de rol',
  USER_ACTIVATED: 'Usuario activado',
  USER_DEACTIVATED: 'Usuario desactivado',
  SEED_USER_CREATED: 'Usuario inicial (seed)',
  CATALOGO_IMPORTADO: 'Catálogo importado',
  PACIENTE_FELICITADO: 'Felicitación de cumpleaños',
  DESCUENTO_CUMPLEANOS_CONFIGURED: 'Descuento de cumpleaños configurado',
  CATEGORIA_CREATED: 'Categoría creada',
  CATEGORIA_UPDATED: 'Categoría editada',
  CATEGORIA_STATUS_CHANGED: 'Estado de categoría',
  SERVICIO_CREATED: 'Servicio creado',
  SERVICIO_UPDATED: 'Servicio editado',
  SERVICIO_STATUS_CHANGED: 'Estado de servicio',
  CONVENIO_CREATED: 'Convenio creado',
  CONVENIO_UPDATED: 'Convenio editado',
  CONVENIO_STATUS_CHANGED: 'Estado de convenio',
};
