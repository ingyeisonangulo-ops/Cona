-- 011: El descuento de cumpleaños pasa a ser un convenio del sistema.
--
-- Reemplaza el descuento automático de la migración 010. "Cumpleaños" es un
-- convenio más (su porcentaje lo define quien administra convenios), pero solo se
-- puede usar en el mes de cumpleaños del paciente y en un único día de ese mes,
-- sobre toda la cuenta de ese día. Las reglas las aplica la API.
-- El mismo porcentaje rige para todas las categorías.

ALTER TABLE convenios ADD COLUMN tipo text NOT NULL DEFAULT 'normal'
  CHECK (tipo IN ('normal', 'cumpleanos'));

CREATE UNIQUE INDEX convenios_org_cumpleanos_uq ON convenios (organization_id) WHERE tipo = 'cumpleanos';

-- Si ya existe un convenio con ese nombre se convierte; si no, se crea sin
-- porcentaje (no descuenta nada hasta que se defina).
UPDATE convenios SET tipo = 'cumpleanos' WHERE lower(nombre) IN ('cumpleaños', 'cumpleanos');

INSERT INTO convenios (organization_id, nombre, entidad, tipo)
SELECT o.id, 'Cumpleaños', 'Clínica', 'cumpleanos'
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM convenios c WHERE c.organization_id = o.id AND c.tipo = 'cumpleanos');

ALTER TABLE configuracion_recurrencia DROP COLUMN descuento_cumpleanos_pct;
ALTER TABLE servicios_realizados DROP COLUMN descuento_cumpleanos;
