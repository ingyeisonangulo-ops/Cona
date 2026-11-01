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
    Durante el bloqueo se responde 429 con un mensaje uniforme (igual para cuentas existentes e inexistentes).
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
41. **Íconos y logo provisionales** (amanecer con trazo rojo sobre azul institucional) generados por `frontend/scripts/generate-icons.mjs`. Reemplazar por el logo oficial en `src/components/Logo.jsx` y `public/icons/`.
42. CSP estricta (`default-src 'self'`, sin inline scripts, `frame-ancestors 'none'`), HSTS en producción.
43. `npm audit` reporta un aviso en `deepmerge` dentro de `workbox-build` (dependencia **solo de build**, no se incluye en el bundle). Se acepta; revisar al actualizar vite-plugin-pwa.
44. Los KPI de finanzas, citas, recurrencia y progreso se muestran como "Disponible en un próximo bloque" (sin datos inventados); los de catálogo usan datos reales.
