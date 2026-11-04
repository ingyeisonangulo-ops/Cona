# Registro de decisiones

Ambigüedades resueltas con la opción más conservadora durante la construcción.
Formato: decisión · motivo.

## Arquitectura y despliegue

1. **Frontend y API en el mismo origen** (Express sirve `frontend/dist` en producción; Vite hace proxy de `/api` en desarrollo).
   Motivo: las cookies `SameSite=Strict` no viajan entre dominios distintos, y `*.up.railway.app` está en la Public Suffix List (dos servicios Railway = dos "sitios").
2. **Dos conexiones a PostgreSQL**: `MIGRATION_DATABASE_URL` (dueño del esquema, solo para migraciones/seed) y `APP_DATABASE_URL` (rol `crm_app`).
   `scripts/migrate.js` crea/ajusta `crm_app` con `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`, y el servidor **se niega a arrancar** si su rol es superusuario o tiene `BYPASSRLS`.
3. **`SET LOCAL app.current_user_id = $1` se implementa como `SELECT set_config('app.current_user_id', $1, true)`.**
   Motivo: `SET` no admite placeholders en PostgreSQL; `set_config(..., true)` es el equivalente transaccional exacto y permite consulta parametrizada.
4. **`db.query()` es el único punto de acceso**. Dentro de `db.transaction(userId, fn)` usa (vía `AsyncLocalStorage`) el cliente de la transacción con la identidad fijada; fuera, usa el pool sin identidad, donde RLS no devuelve filas.
5. **`FORCE ROW LEVEL SECURITY` en todas las tablas** con datos de organización/usuario. Requiere que el dueño que ejecuta migraciones sea superusuario o tenga `BYPASSRLS` (el usuario `postgres` de Railway lo es).
6. **Operaciones previas a la identidad (login, refresh, recuperación) solo vía funciones `SECURITY DEFINER`** con `search_path` fijo y `EXECUTE` revocado a `PUBLIC`. `crm_app` no tiene acceso directo a `auth_throttle`, `password_reset_tokens` ni INSERT en `audit_logs`.
7. **Migraciones inmutables con checksum SHA-256** y `pg_advisory_lock`; `.gitattributes` fuerza `eol=lf` para que el checksum no cambie entre Windows y Linux.
8. `DB_SSL` por defecto `verify-full`. En la red privada de Railway (`*.railway.internal`) usar `disable`; con el proxy público, `require`.

## Autenticación y sesiones

9. **bcryptjs** (implementación JS pura) en lugar de `bcrypt` nativo: evita compilación nativa en Windows/Railway. Cost 12, verificado por test.
10. **Contraseñas > 72 bytes se rechazan** (bcrypt trunca silenciosamente); también se rechazan espacios al inicio/fin.
11. **Timing equilibrado**: si la cuenta no existe se compara contra un hash bcrypt ficticio; las cuentas inactivas se evalúan después de la comparación.
12. **Bloqueo**: 5 fallos en 15 min por **cuenta** (aunque no exista, para no permitir enumeración) y 5 por **IP**, ambos con bloqueo de 15 min. El éxito reinicia solo el contador de la cuenta, no el de la IP. Los umbrales son configurables (`LOCKOUT_*`): si la clínica comparte una IP pública (NAT), puede subirse `LOCKOUT_MAX_ATTEMPTS_IP`.
    **(Revisado en Bloque 2)** Durante el bloqueo se responde **401 "Email o contraseña incorrectos"**, idéntico a cualquier fallo y ejecutando igualmente bcrypt (mismo tiempo). Así no se revela si la cuenta existe, está inactiva o bloqueada. Como contrapartida de usabilidad, la pantalla de login muestra siempre el aviso fijo "tras 5 intentos fallidos el acceso se bloquea durante 15 minutos".
13. **Access token JWT HS256 de 15 min** con solo `sub` y `tv` (token_version). Rol, estado y permisos se recargan de la BD en cada request, para que un cambio de rol o desactivación surta efecto inmediato.
14. **Refresh token opaco rotativo** (7 días, vida máxima de la familia 30 días), almacenado como SHA-256. Reutilizar un token ya rotado revoca toda la familia y se audita (`REFRESH_TOKEN_REUSE`).
15. Cookies `HttpOnly; Secure; SameSite=Strict` con prefijos `__Host-` (access, `Path=/`) y `__Secure-` (refresh, `Path=/api/auth`). `COOKIE_SECURE=false` solo se permite fuera de producción.
16. **Defensa CSRF adicional**: toda petición que modifica estado debe traer `Origin` igual a `APP_ORIGIN`.
17. **Recuperación de contraseña sin correo saliente**: no hay proveedor de email definido. El flujo seguro elegido es:
    - `/recuperar` responde siempre con un mensaje genérico y registra `PASSWORD_RESET_REQUESTED` en la bitácora (visible para administradores).
    - Un Super Admin/Gerente genera desde **Usuarios** un **enlace de un solo uso (60 min)** que entrega al usuario por un canal seguro. El token viaja en el fragmento `#token=` (no llega a logs del servidor) y se guarda hasheado.
    - Emitir el enlace **invalida de inmediato** las sesiones del usuario; consumirlo fija la nueva contraseña, sube `token_version`, revoca refresh tokens y limpia el bloqueo de la cuenta.
    Integrar un proveedor de correo queda como mejora futura sin cambiar el modelo de datos.
18. **Usuarios nuevos reciben contraseña temporal** (`must_change_password = true`): la UI solo permite el Perfil hasta cambiarla.
19. Cambiar la contraseña propia o "cerrar todas las sesiones" invalida **todas** las sesiones, incluida la actual (se vuelve al login).

## Autorización

20. **3 capas**: (1) `authenticate` (cookie + BD), (2) `requirePermission(...)` contra `matrix.json`, (3) pertenencia vía RLS + `requireFound()` → **404**. Las violaciones de RLS/guardas en BD (`42501`) también se traducen a 404.
    La falta de permiso de rol responde 403 (la existencia del endpoint no es secreta; la de los registros sí).
21. **Un Gerente no puede ver en detalle, editar, desactivar, desbloquear ni restablecer a un Super Admin** (404), ni crear/asignar el rol Super Admin. Reforzado en BD por el trigger `users_guard` y `app_can_manage_user()`.
22. **Nadie puede cambiar su propio rol ni desactivarse a sí mismo** (evita quedar sin administradores).
23. Usuarios: **sin borrado físico** (no hay política DELETE); se desactivan.
24. **Pantalla de Roles y Permisos de solo lectura**, protegida con `MANAGE_USERS` (Super Admin y Gerente). Cambiar permisos = editar `matrix.json` y desplegar (queda versionado en git).
25. Test automático garantiza que los roles del `CHECK` de la tabla `users` coinciden con `matrix.json` y que todo permiso usado en rutas existe en la matriz.

## Bitácora de auditoría

26. `audit_logs` inmutable por **tres mecanismos**: sin GRANT de UPDATE/DELETE a `crm_app`, triggers que rechazan UPDATE/DELETE/TRUNCATE (incluso para el dueño) y escritura solo vía `app_audit_log()`.
27. Con identidad en contexto, `app_audit_log()` **ignora** la organización/actor que envíe la app y usa los de la sesión (no suplantable).
28. **Toda escritura autenticada se audita automáticamente** en `txRoute` (dentro de la misma transacción: si la operación se revierte, su registro también). Acciones sin nombre explícito quedan como `WRITE_<METHOD>`.
29. Intentos de login contra cuentas inexistentes se registran con `organization_id = NULL` (no pertenecen a ningún tenant); solo son visibles para el DBA.
30. Nunca se registran contraseñas ni tokens; sí el email intentado en fallos de login.

## Catálogo (Servicios, Categorías, Convenios)

31. **Lectura**: cualquier rol con `MANAGE_SERVICES`, `REGISTER_SERVICES` o `VIEW_ROLE_SERVICES` (hoy, los cuatro roles). **Escritura y cambio de estado**: solo `MANAGE_SERVICES` (Super Admin y Gerente), reforzado por RLS con `app_is_admin()`.
32. **Desactivación lógica** (`status = active|inactive`); el borrado físico está bloqueado por trigger y sin GRANT.
33. **No se puede desactivar una categoría con servicios activos**, ni activar un servicio cuya categoría esté inactiva. Un servicio nuevo o movido exige categoría activa.
34. Nombres únicos por organización sin distinguir mayúsculas (`lower(nombre)`).
35. Montos en `numeric(14,2)` (COP, sin errores de coma flotante en BD); puntos enteros ≥ 0.
36. `porcentaje_descuento_categoria` = objeto JSON `{ "<categoria_id>": 0..100 }`; las claves deben ser categorías existentes de la organización. Categoría ausente = sin descuento.
37. `created_by/updated_by/updated_at` se estampan en BD desde `app.current_user_id` (no confiables desde la app).

## PWA y frontend

38. Service Worker (vite-plugin-pwa / Workbox, `generateSW`): precache del app shell, **cache-first** para estáticos, **network-first** para GET `/api/*` y **network-only** para `/api/auth/*`. Registrado **solo en producción**.
39. Los datos de API cacheados (posible información clínica) se limitan a 60 entradas / 5 min y **se borran al cerrar sesión**; el backend además responde `Cache-Control: no-store`.
40. Actualización del SW con confirmación del usuario (no recarga en medio de un formulario).
41. **Logo oficial CONA** (reemplaza al isotipo provisional). El original (`frontend/branding/logo-cona.png`, 1500×1500 con fondo blanco, ~0,5 MB; reemplazó a la primera versión) **no se publica**; `npm --prefix frontend run icons` (sharp) genera: logo completo con nombre y lema (login), marca "cona" + diente (barra lateral y encabezado móvil), isotipo del diente (favicon e íconos PWA 192/512/maskable/Apple sobre fondo blanco). El texto del logo es oscuro, por eso sobre el panel azul del login va en una placa blanca. El isotipo se separa de la letra "a" retirando los grises de esa zona.
41b. **Rediseño visual (sistema de diseño minimalista)** según referencias del cliente: fondo gris azulado muy claro, tarjetas blancas con borde fino y sombra mínima (radio 16 px), KPIs con ícono en cuadro con tinte, pastillas de estado suaves, tablas con encabezado en "píldora" gris, barra lateral blanca con secciones (Operación, Gestión, Administración), ítem activo en azul, contador de inasistencias y tarjeta de usuario; barra superior con fecha y campana de alertas. Tipografía **Inter** auto-alojada (`@fontsource-variable/inter`, compatible con la CSP `font-src 'self'`). El login se conserva.
41c. **Gráficas** sin librerías (SVG/HTML propios): área suavizada con cursor y tooltip, dona con valor central, columnas finas con pista, medidores. Cada gráfica tiene vista de **Tabla** accesible. Paleta categorica fija y validada para daltonismo (azul #1E65D6, teal #14B8A6, violeta #8B5CF6; "Otro" en gris); verde/ámbar/rojo reservados a estados y siempre con etiqueta. El tablero agrega la **serie diaria** de ingresos/costos y la **variación vs mes anterior** de los KPI.
41d. **Dirección «Clínica serena»** (propuesta aprobada por la clínica): fondo #F6F7F9, bordes #ECEEF2, texto #0B1220/#667085; azul CONA como único color de acción; una **tarjeta destacada en azul noche** (#0F2A57) por pantalla (ingreso en el tablero, citas de hoy en el inicio operativo, puntos en Mi progreso); rojo CONA solo para alertas. Títulos y cifras en **Plus Jakarta Sans** (paquete @fontsource-variable, cumple CSP `font-src 'self'`); el login conserva su tipografía. Menú lateral con ítem activo en tinte suave y opción de **contraer a franja de íconos** (preferencia por navegador en localStorage, opcional). En móvil y tableta, **barra inferior** con 3 accesos según rol + Menú. Agenda con selector de semana; Registro con indicador de pasos (Paciente → Servicios → Confirmar), solo informativo.
41e. **Ajustes solicitados por la clínica:** Inasistencias en dos pestañas (**Estados** con las gráficas y **Seguimientos del mes** con la tabla); en Agenda, las etiquetas En 2 días / Mañana-hoy / Vencida del panel «Requieren atención» son **filtros** (un clic filtra, otro clic quita el filtro); catálogo en **listas** (sin tarjetas) con filtro de servicios por categoría; el resumen del mes muestra Ingreso total, Costos, Utilidad neta y Servicios realizados (pacientes nuevos sigue en la dona de canales).
41f. **Convenio con un solo porcentaje** que se aplica a las categorías que el usuario marca (por defecto todas). Se guarda en el mismo `porcentaje_descuento_categoria` con el mismo valor por categoría, así que el cálculo del servidor y los registros existentes no cambian. Si un convenio antiguo tenía porcentajes distintos, la lista muestra el mayor y el formulario avisa que al guardar quedará uno solo.
41g. **Costo para la clínica solo para quien administra el catálogo** (`MANAGE_SERVICES`: Super Admin y Gerente). La Asistente ve el valor al público pero la API omite `costoClinica` en el catálogo y `costoAplicado` en los servicios realizados; la pantalla oculta la columna. Pruebas de integración lo verifican.
41h. **Cargos del personal clínico** (migración 008). Los **roles** de `matrix.json` no cambian (siguen definiendo permisos); se agrega el **cargo**: un Colaborador es Odontólogo, Higienista, Auxiliar o Especialista (obligatorio); la Asistente tiene el cargo «Asistente» y también es colaboradora (registra servicios a su nombre, tiene metas, Mi progreso y aparece en el desempeño); Gerente y Super Admin no tienen cargo. Cada servicio declara los **cargos que lo realizan**; la base de datos rechaza registrar o agendar un servicio con alguien de otro cargo (solo al crear o cambiar servicio/colaborador, para no bloquear anulaciones de registros antiguos) y el Colaborador solo ve en el catálogo los servicios de su cargo (otro cargo → 404). Datos existentes: los Colaboradores quedaron como Odontólogo y los servicios con todos los cargos, para no invalidar nada; el Gerente los ajusta desde Usuarios y Servicios. En el formulario de usuario, el selector «Rol» muestra directamente los cargos de colaborador, como pidió la clínica.
41i. **Publicación en Vercel + Neon** (Railway no admite cuentas nuevas desde el 21 de octubre de 2026). Para conservar las cookies `SameSite=Strict`, frontend y API comparten dominio: el frontend es estático y la API Express corre como función de Vercel (`api/index.js`, mismo `createApp()`), que verifica en cada arranque en frío que el rol de BD no pueda saltarse RLS (igual que `server.js`). Las migraciones corren en el build solo cuando `VERCEL_ENV=production`, para que las vistas previas no alteren la base real. Las cabeceras de seguridad del sitio estático replican la CSP de helmet en `vercel.json`. Base de datos en Neon (desde el panel de Vercel) con el mismo esquema de dos roles: dueño para migraciones/seed y `crm_app` sin superusuario ni BYPASSRLS para la app. Railway queda documentado como alternativa.
41j. **Fecha de nacimiento y Cumpleañeros** (migración 009). La columna admite NULL porque los pacientes existentes no la tienen; la API la exige solo al crear pacientes y al editar es opcional (si se omite, se conserva). Cumpleañeros usa el permiso `SEARCH_PATIENTS` y expone solo nombre y día; navega los 12 meses en ciclo, sin año. Quien nació el 29 de febrero aparece en febrero con día 29.
41k. **Felicitación y convenio Cumpleaños** (migraciones 010 y 011). La felicitación se guarda por paciente y año; años, felicitación y descuento siempre son del año en curso. El descuento es un **convenio del sistema** llamado Cumpleaños (`convenios.tipo = 'cumpleanos'`), que existe en toda organización y sin porcentaje no descuenta nada. Su porcentaje lo define quien administra convenios (Gerente y Super Admin) y rige para todas las categorías, incluidas las que se creen después; nombre y entidad no se editan. La clínica lo **elige** al registrar: solo aparece en el mes de cumpleaños del paciente y **se usa en un único día del mes**, sobre toda la cuenta (si un servicio lo lleva, la API lo aplica a todos los de esa atención, salvo los de valor manual). Ese mismo día se puede registrar otra atención con el convenio; otro día del mes se rechaza. Un servicio anulado libera el uso. Como cada servicio tiene un solo convenio, no se suma con otros, y sus cifras salen en convenios del tablero. Estado en Cumpleañeros: **Aplicado** si hay un servicio no anulado con el convenio; si no, **Vencido** (el mes ya pasó), **Pendiente** (mes actual) o **No aplica** (mes futuro). Reemplaza el descuento automático de la migración 010, que nunca llegó a producción.
41l. **Vista por cargo.** La relación cargo → categoría → servicios se deriva de los cargos de cada servicio: el Colaborador solo ve las categorías con al menos un servicio de su cargo, con el conteo de esos servicios; otra categoría responde 404. La Asistente sigue viendo todo el catálogo porque registra servicios de todo el personal, pero la API le omite puntos y costo. El Colaborador conserva los puntos porque son los de su progreso. El Colaborador no tiene Inicio: `/` lo lleva a Mi progreso.
41m. **Género y barrio del paciente** (migración 012). Admiten NULL porque los pacientes existentes no los tienen; la API los exige solo al crear pacientes y al editar son opcionales (si se omiten, se conservan). Género acepta solo F o M. Barrio admite letras, números, espacios y los signos . , # ° -; se valida al guardar.
41n. **Métricas de la clínica** (`VIEW_DASHBOARD_FINANCE`). Se consultan por año sobre servicios no anulados: servicios, pacientes, ingresos, costos y utilidad por mes, y pacientes, servicios e ingresos por género y rango de edad. La edad es la que el paciente cumple en el año consultado, para que cada paciente quede en un solo rango. El total de pacientes del año cuenta a cada uno una vez, por eso no es la suma de los meses. Los pacientes sin género o fecha de nacimiento van en «Sin dato». Si hay servicios con costo $0 se avisa, porque la utilidad sale mayor que la real. No se agregan datos históricos: las métricas crecen con cada registro.
42. CSP estricta (`default-src 'self'`, sin inline scripts, `frame-ancestors 'none'`), HSTS en producción.
43. `npm audit` reporta un aviso en `deepmerge` dentro de `workbox-build` (dependencia **solo de build**, no se incluye en el bundle). Se acepta; revisar al actualizar vite-plugin-pwa.
44. ~~KPI pendientes~~ (Bloque 1). En el Bloque 2 todos los indicadores usan datos reales; el inicio depende del rol: Tablero gerencial (finanzas), panel operativo (Asistente) o Mi progreso (Colaborador).

## Bloque 2 — Operación clínica

### Pacientes y registro de servicios (RF-08)
45. **Cédula única por organización**, normalizada (sin puntos, guiones ni espacios; mayúsculas), 4–15 caracteres alfanuméricos para admitir CE/pasaporte. Es **inmutable** (trigger).
46. **RF-08**: si la cédula existe, el servidor **ignora** cualquier dato personal enviado en `/api/atenciones` (no se puede sobrescribir un paciente desde el formulario de registro). La edición de contacto es una acción aparte y auditada (`PUT /api/pacientes/:id`, requiere `REGISTER_SERVICES` y `SEARCH_PATIENTS`).
47. **El servidor calcula todos los valores** (nunca confía en el cliente): `valor_cobrado = valor_público × (1 − %descuento del convenio para la categoría del servicio)`; `costo_aplicado = costo_clínica`; `puntos` del catálogo. Los valores quedan **congelados** en el registro (cambios posteriores del catálogo no alteran el histórico).
48. **"Otros" = valor manual** del servicio seleccionado, activado con un clic explícito, con **motivo obligatorio** (≥ 5 caracteres). Se marca `valor_manual`, anula el convenio para ese ítem, conserva el costo del catálogo y queda auditado. Los convenios con valor manual no cuentan en el ranking de descuentos.
49. El **colaborador** de un servicio debe ser un usuario activo con rol **Colaborador** de la misma organización (validado en BD). La fecha del servicio no puede ser futura.
50. **Sin borrado de servicios realizados**: se corrigen con edición (Asistente/Gerente) o se **anulan** con motivo (solo `MANAGE_SERVICES`). Los anulados salen de métricas, puntos y comisiones.
51. **Historial inmutable** (`servicios_realizados_historial`): un trigger guarda una instantánea completa en cada INSERT/UPDATE con usuario y fecha; no admite UPDATE/DELETE/TRUNCATE. Además, cada operación se registra en `audit_logs`.

### Agenda
52. **Slots de 30 min** (hh:00 / hh:30) de **07:00 a 18:30**, y **una cita vigente por horario** en toda la clínica (índice único parcial; las citas Aplazadas liberan el slot). Ajustable en `routes/citas.js` (`AGENDA`) y el CHECK de la tabla.
53. Se agregó `colaborador_id` (opcional) a `Cita`: sin él no es posible el RF-32 ("Mis citas" del colaborador). También `tipo` (`normal` / `control` / `reagendada`) junto a `cita_origen_id`.
54. **Transiciones**: Pendiente → Confirmado; Pendiente/Confirmado → Cumplida, Ausente o Aplazado. Cumplida, Ausente y Aplazado son **finales**. No se marca Cumplida/Ausente una cita futura ni se agenda en el pasado. Aplazar crea la nueva cita (`reagendada`) y conserva la original como historial.
55. **Alertas** (zona America/Bogota): amarillo = faltan 2 días; naranja = mañana **u hoy** (aún no vencida); rojo = fecha/hora pasada sin cumplir (Pendiente/Confirmado).
56. La **cita de control** solo se agenda al marcar Cumplida y hereda servicio y colaborador si no se indican.

### Inasistencias
57. Solo se cierran citas en estado **Ausente**, **una vez** (cierre inmutable). Motivo "Otros" exige observación. **(Revisado)** Canales de contacto: solo **Llamada** y **WhatsApp** (migración 007; los cierres anteriores con otros canales se conservan y siguen apareciendo en las gráficas).
57b. **Estado del seguimiento** (columna y gráfica): **Pendiente** = cita Ausente sin cierre; **Responde** = se logró comunicación (motivo obligatorio, puede reagendar); **No responde** = no se logró comunicación (se registra el canal intentado; sin motivo ni reagendamiento). "No responde" cierra el caso. Las gráficas de Inasistencias son por **mes de la cita**: motivos y canal cuentan solo seguimientos con respuesta; reagendamiento y respuesta cuentan todos los seguimientos realizados (cerrados).
58. Reagendar desde el cierre exige además `MANAGE_APPOINTMENTS` y crea la cita en la misma transacción.

### Metas, comisiones y recurrencia
59. **Semanas fijas**: 1–7, 8–14, 15–21 y 22–fin (los días 29–31 van a la semana 4).
60. **Propuesta semanal proporcional a los días** de cada semana: semanas 1–3 = ⌊meta × 7 / días del mes⌋ y el residuo va a la semana 4. El Gerente puede ajustarla manualmente (debe sumar la meta; validado en API y BD). La meta en dinero se distribuye con la misma regla.
61. **Comisión** = `(puntos logrados − meta) × valor punto adicional` **solo si** puntos logrados ≥ meta; si no, 0. Exactamente la meta da comisión 0.
62. **Tasa de recurrencia global** del mes M = pacientes con servicio registrado en M−1 que **también** tienen servicio en M ÷ pacientes con servicio en M−1. Se basa en servicios realizados (no en citas).
63. **Bono automático**: ≥ 80% otorga los puntos del nivel 80; ≥ 60% los del nivel 60 (**no acumulativos**). Se suma a los puntos de cada colaborador **con meta asignada en el mes** y por tanto puede generar comisión. Se calcula en vivo (es provisional mientras el mes no termine). Configuración por organización con nivel 80 ≥ nivel 60.
64. La tasa se expone mediante una función `SECURITY DEFINER` que solo devuelve agregados, para que el Colaborador (que por RLS no ve filas ajenas) pueda conocerla.

### Privacidad del Colaborador
65. **Defensa en profundidad**: RLS impide al rol Colaborador leer `pacientes` y `cierres_ausencia`, y limita `citas`, `servicios_realizados` y `metas_colaborador` a **sus propias filas**. La API de "Mi progreso" arma la respuesta por **lista blanca** (solo puntos, metas en puntos y cantidades): sin dinero, comisiones, datos de pacientes ni ocupación de agenda.
66. **Catálogo para Colaborador**: ve servicios y categorías con sus puntos, **sin** `valorPublico`/`costoClinica`, y no accede a convenios (`/api/convenios` exige `MANAGE_SERVICES` o `REGISTER_SERVICES`).
67. RF-32: "no cumplidas" = Ausente + Pendiente/Confirmado ya vencidas. Se muestran también las "programadas" (futuras) como cantidad.
68. Las comisiones son dinero: **no** se muestran al Colaborador (solo en el Tablero gerencial).

### Tablero gerencial
69. Solo `VIEW_DASHBOARD_FINANCE` (Super Admin, Gerente). Periodo mensual. "Servicios agendados" = citas del mes excepto Aplazadas.
70. **Clasificación de rentabilidad** por utilidad total del mes: top N = "más rentables" y bottom N = "menos rentables", con N = min(3, ⌊servicios/2⌋) para no solaparse.

### Auditoría de seguridad y pruebas
71. `scripts/audit-security.js` es **autocontenido**: levanta PostgreSQL en memoria (PGlite, devDependency) con las migraciones y el seed reales y la API real con el rol `crm_app`. No toca la base de datos de producción. Para aislar la prueba de bloqueo por cuenta usa un umbral de IP alto; el bloqueo por IP se verifica en `test:integration`.
72. El paso del tiempo (15 min de bloqueo, citas vencidas) se simula ajustando filas como dueño de la BD dentro del entorno de prueba.
73. Un `DELETE` forzado sobre un router protegido por permiso responde **403** (el guard del router se evalúa antes de resolver la ruta) y sobre rutas sin borrado **404**; ambas respuestas son seguras (solo `{ error }`) y el registro permanece.
74. Las fechas `DATE` se transportan como texto `YYYY-MM-DD` (parser de `pg`) para evitar corrimientos de día por zona horaria.
