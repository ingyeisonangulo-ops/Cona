-- 009: Fecha de nacimiento del paciente (apartado Cumpleañeros).
-- Admite NULL porque los pacientes existentes no la tienen: la API la exige al
-- crear pacientes nuevos y a los existentes se les agrega al editar sus datos.

ALTER TABLE pacientes ADD COLUMN fecha_nacimiento date
  CHECK (fecha_nacimiento >= DATE '1900-01-01');

CREATE INDEX pacientes_org_mes_nacimiento_idx ON pacientes (organization_id, (extract(month FROM fecha_nacimiento)))
  WHERE fecha_nacimiento IS NOT NULL;
