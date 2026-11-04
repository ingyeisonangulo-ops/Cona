-- 012: Género y barrio del paciente.
-- Admiten NULL porque los pacientes existentes no los tienen: la API los exige al
-- crear pacientes nuevos y a los existentes se les agregan al editar sus datos.

ALTER TABLE pacientes
  ADD COLUMN genero text CHECK (genero IN ('F', 'M')),
  ADD COLUMN barrio text CHECK (length(btrim(barrio)) BETWEEN 2 AND 80);
