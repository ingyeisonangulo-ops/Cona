# CRM y Tablero Gerencial — IPS Centro Odontológico Nuevo Amanecer del Pacífico SAS

React (Vite) + TailwindCSS · Node.js (Express, ESM) · PostgreSQL con RLS · PWA.

## Estructura

```
backend/
  matrix.json            Fuente única de permisos por rol
  migrations/            SQL versionado (001…005), aplicado por scripts/migrate.js
  scripts/migrate.js     Crea el rol crm_app y aplica migraciones (con checksum)
  scripts/seed.js        Seed idempotente (Super Admin; en dev, un usuario por rol + catálogo)
  src/db.js              db.query() + db.transaction(userId) con app.current_user_id
  src/middleware/        authenticate (capa 1), authorize (capa 2), seguridad, errores
  src/lib/txRoute.js     Transacción por request + auditoría automática de escrituras
  src/routes/            auth, users, roles/auditoría, catálogo
  test/                  node:test
frontend/
  src/pages/             Login, recuperación, tablero, catálogo, usuarios, roles, auditoría, perfil
  src/components/        Layout (sidebar/header), UI con tokens de diseño
  vite.config.js         Manifest + Service Worker (Workbox)
DECISIONES.md            Decisiones conservadoras tomadas ante ambigüedades
```

## Puesta en marcha (desarrollo)

Requisitos: Node ≥ 22.9 y PostgreSQL ≥ 14.

```bash
cp backend/.env.example backend/.env    # completar valores
npm --prefix backend install
npm --prefix frontend install
npm run migrate
npm run seed
```

Luego, en dos terminales: `npm --prefix backend run dev` y `npm --prefix frontend run dev`, y abrir http://localhost:5173.

El seed de desarrollo crea `gerente@`, `asistente@` y `colaborador@` + `SEED_DEV_EMAIL_DOMAIN`, con la contraseña `SEED_DEV_PASSWORD` (o una generada que se imprime una sola vez).

## Despliegue en Railway (un servicio)

- Build: `npm run build` · Start: `npm start` (aplica migraciones y arranca).
- Variables: las de `backend/.env.example` con `NODE_ENV=production`, `APP_ORIGIN=https://<dominio>`, `MIGRATION_DATABASE_URL` = URL del usuario `postgres`, `APP_DATABASE_URL` = misma base con usuario `crm_app` y `APP_DB_PASSWORD`.
- Ejecutar `npm run seed` una vez con `SEED_SUPERADMIN_EMAIL` y `SEED_SUPERADMIN_PASSWORD`.

## API (resumen)

| Método | Ruta | Permiso |
|---|---|---|
| POST | `/api/auth/login`, `/refresh`, `/logout`, `/forgot-password`, `/reset-password` | público |
| GET | `/api/auth/me` · POST `/change-password`, `/logout-all` | sesión |
| GET/POST/PATCH | `/api/users`, `/:id`, `/:id/status`, `/:id/unlock`, `/:id/reset-password` | MANAGE_USERS |
| GET | `/api/roles` | MANAGE_USERS |
| GET | `/api/audit-logs` | VIEW_AUDIT_LOGS |
| GET | `/api/{categorias,servicios,convenios}` y `/:id` | MANAGE_SERVICES / REGISTER_SERVICES / VIEW_ROLE_SERVICES |
| POST/PUT/PATCH | `/api/{categorias,servicios,convenios}`, `/:id`, `/:id/status` | MANAGE_SERVICES |

## Pruebas

```bash
npm test                                   # unitarias (matriz, contraseñas)
npm --prefix backend run test:integration  # RLS + API completa sobre PostgreSQL en memoria (PGlite)
```

La suite de integración aplica las migraciones reales, ejecuta el seed dos veces (idempotencia), conecta la app con el rol `crm_app` y recorre login, bloqueo, refresh rotativo, usuarios, reset, catálogo y auditoría.
