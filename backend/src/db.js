import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from './config.js';
import { sslOption } from './lib/pgSsl.js';

// DATE como texto 'YYYY-MM-DD': evita corrimientos de día por zona horaria.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

const pool = new pg.Pool({
  connectionString: config.db.url,
  max: config.db.poolMax,
  ssl: sslOption(config.db.ssl),
  application_name: 'nuevo-amanecer-crm',
});

pool.on('error', (err) => {
  console.error('[db] error en cliente inactivo del pool:', err.message);
});

// Contexto de la transacción del request en curso. Mientras exista, db.query()
// se ejecuta en esa transacción, donde app.current_user_id ya está fijado.
const txContext = new AsyncLocalStorage();

export const db = {
  /**
   * Punto único de acceso a la base de datos. Siempre parametrizado ($1, $2...).
   * Dentro de db.transaction() usa el cliente de la transacción (con RLS activo
   * para el usuario); fuera de ella usa el pool sin identidad, por lo que las
   * políticas RLS no devuelven filas y solo funcionan las funciones de auth.
   */
  query(text, params = []) {
    const store = txContext.getStore();
    return (store ? store.client : pool).query(text, params);
  },

  /**
   * Ejecuta `fn` en una transacción. Si se pasa userId, se aplica el equivalente
   * a `SET LOCAL app.current_user_id = $1` (set_config(..., true) permite
   * parametrizarlo; SET no acepta placeholders).
   */
  async transaction(userId, fn) {
    if (txContext.getStore()) {
      throw new Error('Transacciones anidadas no soportadas');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (userId) {
        await client.query("SELECT set_config('app.current_user_id', $1, true)", [String(userId)]);
      }
      const result = await txContext.run({ client, userId }, fn);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Falla si la app está conectada con un rol que puede saltarse RLS.
   */
  async assertRestrictedRole() {
    const { rows } = await pool.query(
      'SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    const role = rows[0];
    if (!role || role.rolsuper || role.rolbypassrls) {
      throw new Error(
        `El rol de base de datos "${role?.name}" es superusuario o tiene BYPASSRLS. ` +
          'La aplicación debe conectarse con el rol crm_app.',
      );
    }
    return role.name;
  },

  close() {
    return pool.end();
  },
};
