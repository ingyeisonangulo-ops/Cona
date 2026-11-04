# CRM y Tablero Gerencial — IPS Centro Odontológico Nuevo Amanecer del Pacífico SAS

React (Vite) + TailwindCSS · Node.js (Express, ESM) · PostgreSQL con RLS · PWA.

Módulos: autenticación y sesiones, usuarios y roles (`matrix.json`), bitácora de auditoría, catálogo (servicios, categorías, convenios), pacientes (RF-08), registro de servicios realizados, agenda con alertas, inasistencias, metas/comisiones/recurrencia, vista del colaborador y tablero gerencial.

---

## 1. Despliegue en Vercel + Neon (PostgreSQL)

Todo queda en **un solo dominio** de Vercel (necesario para las cookies `SameSite=Strict`): el frontend se sirve como sitio estático y la API Express corre como función (`api/index.js`). `vercel.json` reescribe `/api/*` a la función, el resto a `index.html`, y añade las cabeceras de seguridad (CSP, HSTS…). La base de datos es **Neon** (PostgreSQL administrado), que se crea y conecta desde el panel de Vercel.

1. **Suba el repositorio a GitHub** (privado) y en Vercel elija **Add New → Project → Import** ese repositorio. Deje la raíz del repo como *Root Directory*; `vercel.json` define instalación, build y salida (no cambie esos campos en el panel).
2. **Base de datos:** en el proyecto, **Storage → Create Database → Neon**. Elija la región **US East (Washington, D.C.)**, igual que las funciones (`iad1`), y conéctela al proyecto. Vercel agrega variables como `DATABASE_URL` (con *pooler*) y `DATABASE_URL_UNPOOLED` (directa) con el usuario dueño.
3. **Variables de entorno** (Settings → Environment Variables, entorno *Production*):

   | Variable | Valor |
   |---|---|
   | `NODE_ENV` | `production` |
   | `APP_ORIGIN` | URL pública exacta, p. ej. `https://cona-crm.vercel.app` (o su dominio propio) |
   | `MIGRATION_DATABASE_URL` | el valor de `DATABASE_URL_UNPOOLED` (usuario dueño, conexión directa: migraciones y seed) |
   | `APP_DB_PASSWORD` | 32+ caracteres aleatorios (Neon exige contraseñas de alta entropía; use el comando de la sección 3). Es la contraseña del rol `crm_app`, que crea la migración |
   | `APP_DATABASE_URL` | la URL de Neon con el usuario **`crm_app`**: `postgresql://crm_app@<host>/<db>`. La contraseña se toma siempre de `APP_DB_PASSWORD` (si la URL trae otra, se reemplaza) |
   | `DB_SSL` | `verify-full` |
   | `DB_POOL_MAX` | `3` (cada instancia de la función abre pocas conexiones) |
   | `JWT_ACCESS_SECRET` | ≥ 32 caracteres aleatorios (comando en la sección 3) |

4. **Deploy.** En el log del build deben aparecer `[migrate] … aplicada(s)` y luego la compilación del frontend. Las migraciones solo corren en despliegues de **producción**; las vistas previas (*preview*) no tocan la base. Si `APP_DATABASE_URL` aún no es válida en el primer despliegue, corríjala y use **Redeploy**.
5. **Seed de producción** (una vez), desde su equipo con la URL directa de Neon:

   ```bash
   cd backend
   NODE_ENV=production MIGRATION_DATABASE_URL='<DATABASE_URL_UNPOOLED>' SEED_SUPERADMIN_EMAIL=admin@clinica.co SEED_SUPERADMIN_PASSWORD='********' node scripts/seed.js
   ```

6. Abra `https://<su-proyecto>.vercel.app/api/health` → `{"status":"ok"}`. Si responde 503, revise en **Logs** el mensaje `[api]`: la API se niega a atender si `APP_DATABASE_URL` usa un rol con superusuario o `BYPASSRLS` (debe ser `crm_app`).

> **Si la función no logra conectar con el pooler** usando `crm_app`, use en `APP_DATABASE_URL` el host directo (el de `DATABASE_URL_UNPOOLED`) con usuario `crm_app`; funciona igual con menos conexiones simultáneas.

> **Dominio propio:** si agrega uno (Settings → Domains), cambie `APP_ORIGIN` a ese dominio y vuelva a desplegar; las peticiones que modifican datos solo se aceptan desde ese origen exacto.

## 1b. Alternativa: Railway

Se despliega como **un solo servicio** (Express sirve la API y el frontend compilado en el mismo dominio; necesario para las cookies `SameSite=Strict`) más un servicio **PostgreSQL**.

1. Cree un proyecto en Railway y agregue **PostgreSQL** (versión 14 o superior).
2. Agregue un servicio desde este repositorio (raíz del repo). Railway detecta Node.
   - **Build command:** `npm run build`
   - **Start command:** `npm start` (aplica migraciones pendientes y arranca el servidor)
   - Node ≥ 22.9 (definido en `engines`).
3. Configure las **variables de entorno** (sección 3) en el servicio de la app.
4. Genere un dominio público para el servicio y use esa URL en `APP_ORIGIN`.
5. Despliegue. En el log debe verse `[migrate] … aplicada(s)` y luego `escuchando en :PORT — rol BD: crm_app`.
6. Ejecute el **seed de producción** una sola vez (sección 4).

> El servidor **se niega a arrancar** si se conecta a PostgreSQL con un rol superusuario o con `BYPASSRLS`; la app debe usar `crm_app`.

## 2. Migraciones

- SQL versionado en `backend/migrations/NNN_nombre.sql` (001…012), aplicado por `backend/scripts/migrate.js` en orden, cada archivo en su transacción, con `pg_advisory_lock` y checksum SHA-256 (un archivo ya aplicado no puede modificarse: cree una migración nueva).
- El mismo script **crea o ajusta el rol `crm_app`** (`LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`) con la contraseña `APP_DB_PASSWORD`.
- Se ejecuta automáticamente en cada `npm start`. Manualmente:

```bash
npm run migrate
```

## 3. Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `NODE_ENV` | sí | `production` en Railway. |
| `PORT` | no | Railway la inyecta. |
| `APP_ORIGIN` | sí | URL pública exacta, p. ej. `https://crm-nuevoamanecer.up.railway.app` (https obligatorio en producción). |
| `MIGRATION_DATABASE_URL` | sí | URL del usuario dueño (en Railway: `${{Postgres.DATABASE_URL}}`, usuario `postgres`). Solo migraciones y seed. |
| `APP_DB_PASSWORD` | sí | Contraseña del rol `crm_app` (≥ 16 caracteres aleatorios). |
| `APP_DATABASE_URL` | sí | Misma base con el usuario `crm_app`: `postgresql://crm_app:<APP_DB_PASSWORD>@<host>:<puerto>/<db>`. |
| `DB_SSL` | sí | `disable` con red privada (`*.railway.internal`); `require` con el proxy público. |
| `JWT_ACCESS_SECRET` | sí | ≥ 32 caracteres aleatorios: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `ACCESS_TOKEN_TTL_SECONDS` | no | 900 por defecto. |
| `REFRESH_TOKEN_TTL_DAYS` / `REFRESH_FAMILY_MAX_DAYS` | no | 7 / 30 por defecto. |
| `LOCKOUT_MAX_ATTEMPTS_ACCOUNT` / `LOCKOUT_MAX_ATTEMPTS_IP` | no | 5 / 5. Suba el de IP si toda la clínica sale por una sola IP pública. |
| `LOCKOUT_WINDOW_MINUTES` / `LOCKOUT_DURATION_MINUTES` | no | 15 / 15. |
| `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD` | para el seed | Primer Super Admin (contraseña ≥ 12 caracteres). |
| `SEED_ORG_NAME`, `SEED_SUPERADMIN_NAME` | no | Nombre de la organización y del administrador. |
| `COOKIE_SECURE` | no | Siempre `true` en producción (el servidor rechaza `false`). |

Plantilla completa: [backend/.env.example](backend/.env.example).

## 4. Seed idempotente de producción

Crea (si no existen) la organización y el Super Admin. Nunca sobrescribe contraseñas ni duplica registros; puede ejecutarse varias veces. Con `NODE_ENV=production` **no** crea usuarios ni datos de prueba.

Desde la CLI de Railway, con las variables del servicio:

```bash
railway run npm run seed
```

(`railway run` ejecuta en su equipo: si `MIGRATION_DATABASE_URL` usa el host privado `*.railway.internal`, reemplácelo por la URL pública de Postgres y use `DB_SSL=require`.)

O localmente, apuntando `MIGRATION_DATABASE_URL` a la base de producción:

```bash
NODE_ENV=production SEED_SUPERADMIN_EMAIL=admin@clinica.co SEED_SUPERADMIN_PASSWORD='********' npm run seed
```

Luego ingrese con ese usuario, cree el resto del personal en **Usuarios** (cada uno debe cambiar su contraseña temporal al ingresar), cargue el catálogo y asigne metas.

## 5. Desarrollo local

```bash
cp backend/.env.example backend/.env    # complete los valores
npm --prefix backend install
npm --prefix frontend install
npm run migrate
npm run seed      # en dev crea además gerente@, asistente@ y colaborador@ + catálogo de ejemplo
```

En dos terminales: `npm --prefix backend run dev` y `npm --prefix frontend run dev` → http://localhost:5173.

### Sin PostgreSQL instalado (base embebida + datos ficticios)

```bash
npm --prefix backend run dev:pglite
```

Levanta PostgreSQL embebido (PGlite, datos en `backend/.local-db/`), aplica migraciones, seed y **datos ficticios** (`seed:demo`: colaboradores, ~70 pacientes, servicios desde hace dos meses, citas con alertas, inasistencias y metas) y arranca la API en :3000. En otra terminal: `npm --prefix frontend run dev`. Para empezar de cero, detenga el backend y borre `backend/.local-db/`. Solo para desarrollo (usa una única conexión a la base).

## 6. Pruebas y auditoría de seguridad

```bash
npm test                    # unitarias: matriz de permisos, contraseñas, reglas de metas/comisiones
npm run test:integration    # PostgreSQL en memoria: RLS, API del núcleo y módulos de negocio
npm run audit:security      # auditoría: accesos, bloqueo, respuestas genéricas, RLS y bundle
```

`audit:security` (equivale a `node scripts/audit-security.js` dentro de `backend/`) es autocontenido: levanta PostgreSQL en memoria con las migraciones y el seed reales, prueba la API real con el rol `crm_app`, compila el frontend y escanea el bundle. Reporta cada verificación como **OK / FALLA** y sale con código 1 si algo falla. Requiere las dependencias de desarrollo del backend (`npm --prefix backend install`).

Guía de pruebas manuales para el cliente: [CHECKLIST_QA.md](CHECKLIST_QA.md). Decisiones técnicas: [DECISIONES.md](DECISIONES.md).

## 7. Estructura

```
backend/
  matrix.json              Fuente única de permisos por rol
  migrations/              001 núcleo · 002 auth · 003 auditoría · 004 recuperación · 005 catálogo · 006 operación clínica
  scripts/migrate.js       Rol crm_app + migraciones con checksum
  scripts/seed.js          Seed idempotente
  scripts/audit-security.js Auditoría de seguridad
  src/db.js                db.query() + transacción por request con app.current_user_id
  src/middleware/          Capas 1 y 2 de autorización, CSRF, errores
  src/lib/txRoute.js       Transacción RLS por request + auditoría automática de escrituras
  src/services/            Reglas de negocio (metas, comisiones, recurrencia)
  src/routes/              auth, users, roles/auditoría, catálogo, pacientes, atenciones, citas, colaboradores, tablero
frontend/
  src/pages/               Login, inicio por rol, registro, agenda, inasistencias, pacientes, metas, mi progreso, tablero, catálogo, usuarios, roles, auditoría, perfil
  vite.config.js           Manifest + Service Worker (Workbox)
```

## 8. API (resumen)

| Método | Ruta | Permiso |
|---|---|---|
| POST | `/api/auth/login`, `/refresh`, `/logout`, `/forgot-password`, `/reset-password` | público |
| GET/POST | `/api/auth/me`, `/change-password`, `/logout-all` | sesión |
| * | `/api/users`, `/api/roles` | MANAGE_USERS |
| GET | `/api/audit-logs` | VIEW_AUDIT_LOGS |
| GET | `/api/categorias`, `/api/servicios` | MANAGE_SERVICES / REGISTER_SERVICES / VIEW_ROLE_SERVICES (sin dinero para Colaborador) |
| GET | `/api/convenios` | MANAGE_SERVICES / REGISTER_SERVICES |
| POST/PUT/PATCH | catálogo | MANAGE_SERVICES |
| GET | `/api/pacientes`, `/:id` · `/:id/historial` | SEARCH_PATIENTS · VIEW_PATIENT_HISTORY |
| GET | `/api/pacientes/cedula/:cedula` (RF-08) | SEARCH_PATIENTS / REGISTER_SERVICES / MANAGE_APPOINTMENTS |
| POST | `/api/atenciones` · `/api/servicios-realizados` (GET, PUT, historial) | REGISTER_SERVICES |
| PATCH | `/api/servicios-realizados/:id/anular` | MANAGE_SERVICES |
| * | `/api/citas` (alertas, disponibilidad, estado, aplazar) | MANAGE_APPOINTMENTS |
| * | `/api/cierres-ausencia` | CLOSE_ABSENCES |
| * | `/api/metas`, `/api/configuracion/recurrencia` | MANAGE_COLLABORATORS |
| GET | `/api/mi-progreso` | VIEW_PERSONAL_PROGRESS (+ citas / recurrencia según permiso) |
| GET | `/api/tablero` | VIEW_DASHBOARD_FINANCE |
