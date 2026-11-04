-- 010: Felicitaciones y descuento de cumpleaños.
--
-- Descuento: porcentaje único que define la Gerente (0 = desactivado). Se aplica
-- a los servicios realizados en el mes de cumpleaños del paciente; no se suma al
-- convenio (vale el mayor) y no afecta valores manuales. Cada servicio guarda si
-- lo recibió, para saber si el paciente ya lo usó.

ALTER TABLE configuracion_recurrencia
  ADD COLUMN descuento_cumpleanos_pct numeric(5, 2) NOT NULL DEFAULT 0
  CHECK (descuento_cumpleanos_pct BETWEEN 0 AND 100);

ALTER TABLE servicios_realizados
  ADD COLUMN descuento_cumpleanos boolean NOT NULL DEFAULT false;

CREATE INDEX servicios_realizados_cumpleanos_idx ON servicios_realizados (paciente_id, fecha)
  WHERE descuento_cumpleanos;

-- Una marca por paciente y año. Desmarcar actualiza la fila (no se borra).
CREATE TABLE felicitaciones_cumpleanos (
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  paciente_id      uuid NOT NULL REFERENCES pacientes(id),
  anio             integer NOT NULL CHECK (anio BETWEEN 2020 AND 2100),
  felicitado       boolean NOT NULL DEFAULT true,
  updated_by       uuid REFERENCES users(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (paciente_id, anio)
);
CREATE INDEX felicitaciones_cumpleanos_org_idx ON felicitaciones_cumpleanos (organization_id, anio);

CREATE FUNCTION felicitaciones_cumpleanos_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app_assert_same_org('pacientes', NEW.paciente_id, NEW.organization_id);
  NEW.updated_by := coalesce(app_current_user_id(), NEW.updated_by);
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER felicitaciones_cumpleanos_guard BEFORE INSERT OR UPDATE ON felicitaciones_cumpleanos
  FOR EACH ROW EXECUTE FUNCTION felicitaciones_cumpleanos_guard();

ALTER TABLE felicitaciones_cumpleanos ENABLE ROW LEVEL SECURITY;
ALTER TABLE felicitaciones_cumpleanos FORCE ROW LEVEL SECURITY;
CREATE POLICY felicitaciones_cumpleanos_select ON felicitaciones_cumpleanos FOR SELECT TO crm_app
  USING (organization_id = app_current_org_id() AND app_is_staff());
CREATE POLICY felicitaciones_cumpleanos_insert ON felicitaciones_cumpleanos FOR INSERT TO crm_app
  WITH CHECK (organization_id = app_current_org_id() AND app_is_staff());
CREATE POLICY felicitaciones_cumpleanos_update ON felicitaciones_cumpleanos FOR UPDATE TO crm_app
  USING (organization_id = app_current_org_id() AND app_is_staff())
  WITH CHECK (organization_id = app_current_org_id());
GRANT SELECT, INSERT, UPDATE ON felicitaciones_cumpleanos TO crm_app;
