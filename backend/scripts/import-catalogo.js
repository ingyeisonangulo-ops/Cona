// Carga categorías y servicios desde un JSON (backend/data/*.json) como rol dueño.
//
//   node scripts/import-catalogo.js data/catalogo-odontologo.json            simula
//   node scripts/import-catalogo.js data/catalogo-odontologo.json --aplicar  guarda
//
// Sin --aplicar todo corre en una transacción que se revierte: valida contra la
// base real sin dejar cambios. Es idempotente: las categorías existentes se
// reutilizan y un servicio con el mismo nombre no se modifica (precios, puntos y
// costo que ya estén en la app se conservan).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { pgSslFromEnv } from './_env.js';
import { describeDbUrl } from '../src/lib/dbTarget.js';

const ORG_SLUG = 'nuevo-amanecer-pacifico';

async function main() {
  const [archivo, ...flags] = process.argv.slice(2);
  if (!archivo) throw new Error('Indique el archivo JSON del catálogo');
  const aplicar = flags.includes('--aplicar');
  const url = process.env.MIGRATION_DATABASE_URL?.trim();
  if (!url) throw new Error('Falta la variable de entorno MIGRATION_DATABASE_URL');
  const catalogo = JSON.parse(await readFile(path.resolve(archivo), 'utf8'));

  console.log(`[import] destino: ${describeDbUrl(url).replace(/ \(huella [^)]*\)/, '')}`);
  console.log(`[import] modo: ${aplicar ? 'APLICAR (guarda los cambios)' : 'SIMULACIÓN (no guarda nada)'}`);

  const client = new pg.Client({ connectionString: url, ssl: pgSslFromEnv() });
  await client.connect();
  try {
    await client.query('BEGIN');
    const org = (await client.query('SELECT id FROM organizations WHERE slug = $1', [ORG_SLUG])).rows[0]?.id;
    if (!org) throw new Error('No existe la organización: ejecute primero el seed');

    const total = { categoriasNuevas: 0, categoriasExistentes: 0, serviciosNuevos: 0, serviciosExistentes: [] };
    for (const categoria of catalogo.categorias) {
      const existe = await client.query('SELECT id FROM categorias WHERE organization_id = $1 AND lower(nombre) = lower($2)', [org, categoria.nombre]);
      const categoriaId =
        existe.rows[0]?.id ??
        (await client.query('INSERT INTO categorias (organization_id, nombre) VALUES ($1, $2) RETURNING id', [org, categoria.nombre])).rows[0].id;
      total[existe.rows.length ? 'categoriasExistentes' : 'categoriasNuevas'] += 1;

      let nuevos = 0;
      for (const s of categoria.servicios) {
        const { rowCount } = await client.query(
          `INSERT INTO servicios (organization_id, categoria_id, nombre, valor_publico, costo_clinica, puntos, cargos)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (organization_id, lower(nombre)) DO NOTHING`,
          [org, categoriaId, s.nombre, s.valorPublico, catalogo.costoClinica, s.puntos, catalogo.cargos],
        );
        if (rowCount) nuevos += 1;
        else total.serviciosExistentes.push(s.nombre);
      }
      total.serviciosNuevos += nuevos;
      console.log(`[import] ${String(nuevos).padStart(2)} de ${String(categoria.servicios.length).padStart(2)} servicios nuevos en ${categoria.nombre}`);
    }

    const metadata = {
      archivo: path.basename(archivo),
      categoriasNuevas: total.categoriasNuevas,
      serviciosNuevos: total.serviciosNuevos,
      serviciosOmitidos: total.serviciosExistentes.length,
    };
    await client.query("SELECT app_audit_log('CATALOGO_IMPORTADO', $1, NULL, 'catalogo', NULL, NULL, 'import-catalogo', $2)", [org, JSON.stringify(metadata)]);

    await client.query(aplicar ? 'COMMIT' : 'ROLLBACK');
    console.log(
      `[import] categorías: ${total.categoriasNuevas} nuevas, ${total.categoriasExistentes} ya existían · ` +
        `servicios: ${total.serviciosNuevos} nuevos, ${total.serviciosExistentes.length} ya existían`,
    );
    for (const nombre of total.serviciosExistentes) console.log(`[import] sin cambios (ya existe): ${nombre}`);
    console.log(aplicar ? '[import] GUARDADO' : '[import] simulación terminada: no se guardó nada. Para guardar agregue --aplicar');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`[import] ${err.message}`);
  process.exit(1);
});
