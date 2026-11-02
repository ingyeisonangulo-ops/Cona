-- 007: Resultado del contacto en el seguimiento de inasistencias.
-- Estados del seguimiento (derivados): Pendiente = cita Ausente sin cierre;
-- Responde / No responde = valor de `respuesta` en el cierre.
-- Si el paciente no responde, no hay motivo conocido ni reagendamiento.
-- Canales de contacto: solo Llamada y WhatsApp (NOT VALID conserva los
-- cierres históricos con otros canales; las filas nuevas sí se validan).

ALTER TABLE cierres_ausencia
  ADD COLUMN respuesta text NOT NULL DEFAULT 'Responde' CHECK (respuesta IN ('Responde', 'No responde'));

ALTER TABLE cierres_ausencia ALTER COLUMN motivo DROP NOT NULL;

ALTER TABLE cierres_ausencia ADD CONSTRAINT cierres_ausencia_respuesta_coherente CHECK (
  (respuesta = 'Responde' AND motivo IS NOT NULL)
  OR (respuesta = 'No responde' AND motivo IS NULL AND NOT reagendo)
);

ALTER TABLE cierres_ausencia DROP CONSTRAINT cierres_ausencia_canal_contacto_check;
ALTER TABLE cierres_ausencia ADD CONSTRAINT cierres_ausencia_canal_contacto_check
  CHECK (canal_contacto IN ('Llamada', 'WhatsApp')) NOT VALID;

CREATE INDEX citas_org_estado_fecha_idx ON citas (organization_id, estado, fecha);
