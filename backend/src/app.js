import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { db } from './db.js';
import { authenticate } from './middleware/authenticate.js';
import { errorHandler, notFoundApi } from './middleware/errorHandler.js';
import { noStore, originGuard } from './middleware/security.js';
import { authRouter } from './routes/auth.js';
import { auditRouter, rolesRouter } from './routes/admin.js';
import { categoriasRouter, conveniosRouter, serviciosRouter } from './routes/catalog.js';
import { usersRouter } from './routes/users.js';
import { atencionesRouter, serviciosRealizadosRouter } from './routes/atenciones.js';
import { cierresRouter, citasRouter } from './routes/citas.js';
import { colaboradoresRouter, configuracionRouter, metasRouter, miProgresoRouter } from './routes/colaboradores.js';
import { pacientesRouter } from './routes/pacientes.js';
import { tableroRouter } from './routes/tablero.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // El proveedor (Vercel o Railway) termina TLS en su proxy: confiar en un salto
  // para req.ip (bloqueo por IP) y req.secure.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          manifestSrc: ["'self'"],
          workerSrc: ["'self'"],
        },
      },
      strictTransportSecurity: config.isProd ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );

  // ----------------------------------------------------------------- API
  const api = express.Router();
  api.use(noStore);
  api.use(express.json({ limit: '100kb' }));
  api.use(cookieParser());
  api.use(originGuard);

  api.get('/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ status: 'ok' });
  });

  api.use('/auth', authRouter);
  // Todo lo que sigue exige sesión (capa 1); cada router aplica capas 2 y 3.
  api.use(authenticate);
  api.use('/users', usersRouter);
  api.use('/roles', rolesRouter);
  api.use('/audit-logs', auditRouter);
  api.use('/categorias', categoriasRouter);
  api.use('/servicios', serviciosRouter);
  api.use('/convenios', conveniosRouter);
  api.use('/pacientes', pacientesRouter);
  api.use('/atenciones', atencionesRouter);
  api.use('/servicios-realizados', serviciosRealizadosRouter);
  api.use('/citas', citasRouter);
  api.use('/cierres-ausencia', cierresRouter);
  api.use('/colaboradores', colaboradoresRouter);
  api.use('/metas', metasRouter);
  api.use('/configuracion', configuracionRouter);
  api.use('/mi-progreso', miProgresoRouter);
  api.use('/tablero', tableroRouter);
  api.use(notFoundApi);

  app.use('/api', api);

  // ------------------------------------------- Frontend (mismo origen)
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', config.frontendDist);
  if (existsSync(path.join(dist, 'index.html'))) {
    app.use(
      express.static(dist, {
        index: false,
        setHeaders(res, file) {
          const name = path.basename(file);
          if (file.includes(`${path.sep}assets${path.sep}`)) {
            res.set('Cache-Control', 'public, max-age=31536000, immutable');
          } else if (name === 'sw.js' || name === 'manifest.webmanifest' || name.endsWith('.html')) {
            res.set('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
