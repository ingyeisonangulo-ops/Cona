-- 006: Operación clínica — Pacientes, Servicios realizados (con historial
-- inmutable), Citas, Cierres de inasistencia, Metas de colaboradores y
-- Configuración de recurrencia.
--
-- Privacidad: el rol Colaborador NO puede leer pacientes ni cierres; de
-- servicios realizados, citas y metas solo ve sus propias filas (la API
-- además le devuelve únicamente puntos y cantidades, nunca dinero).

CREATE FUNCTION app_today() RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'America/Bogota')::date
$$;

-- Personal operativo: puede ver y registrar datos de pacientes.
CREATE FUNCTION app_is_staff() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(app_current_role() IN ('Super Admin', 'Gerente', 'Asistente'), false)
$$;

GRANT EXECUTE ON FUNCTION app_today(), app_is_staff() TO crm_app;

-- Verifica que un usuario sea Colaborador activo de la organización.
CREATE FUNCTION app_assert_colaborador(p_user_id uuid, p_org uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND organization_id = p_org
                 AND role = 'Colaborador' AND is_active) THEN
    RAISE EXCEPTION 'El colaborador no es válido' USING ERRCODE = '23503';
  END IF;
END $$;
REVOKE ALL ON FUNCTION app_assert_colaborador(uuid, uuid) FROM PUBLIC;

-- Verifica que una fila referenciada pertenezca a la organización.
CREATE FUNCTION app_assert_same_org(p_table regclass, p_id uuid, p_org uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ok boolean;
BEGIN
  IF p_id IS NULL THEN RETURN; END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE id = $1 AND organization_id = $2)', p_table)
    INTO v_ok USING p_id, p_org;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'Referencia inválida a %', p_table USING ERRCODE = '23503';
  END IF;
END $$;
REVOKE ALL ON FUNCTION app_assert_same_org(regclass, uuid, uuid) FROM PUBLIC;

-- ===========================================================================
-- Pacientes
-- ===========================================================================
CREATE TABLE pacientes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  cedula           text NOT NULL CHECK (cedula ~ '^[0-9A-Z]{4,15}$'),
  nombre           text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 2 AND 80),
  apellido         text NOT NULL CHECK (length(btrim(apellido)) BETWEEN 2 AND 80),
  telefono         text NOT NULL CHECK (telefono ~ '^\+?[0-9 ]{7,20}$'),
  fecha_registro   date NOT NULL DEFAULT app_today(),
  medio_origen     text NOT NULL CHECK (medio_origen IN ('Redes Sociales', 'Televisión', 'Referido', 'Otro')),
  created_by       uuid REFERENCES users(id),
  updated_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pacientes_cedula_uq UNIQUE (organization_id, cedula)
);
CREATE INDEX pacientes_org_apellido_idx ON pacientes (organization_id, lower(apellido), lower(nombre));
CREATE INDEX pacientes_org_fecha_idx ON pacientes (organization_id, fecha_registro);

CREATE FUNCTION pacientes_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cedula <> OLD.cedula THEN
    RAISE EXCEPTION 'La cédula no se puede modificar' USING ERRCODE = '42501';
  END IF;
  NEW.fecha_registro := OLD.fecha_registro;
  RETURN NEW;
END $$;

CREATE TRIGGER pacientes_guard BEFORE UPDATE ON pacientes FOR EACH ROW EXECUTE FUNCTION pacientes_guard();
CREATE TRIGGER pacientes_stamp BEFORE INSERT OR UPDATE ON pacientes FOR EACH ROW EXECUTE FUNCTION catalog_stamp();
CREATE TRIGGER pacientes_no_delete BEFORE DELETE ON pacientes FOR EACH ROW EXECUTE FUNCTION catalog_no_delete();

-- ===========================================================================
-- Citas
-- ===========================================================================
CREATE TABLE citas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  paciente_id      uuid NOT NULL REFERENCES pacientes(id),
  servicio_id      uuid REFERENCES servicios(id),
  colaborador_id   uuid REFERENCES users(id),
  fecha            date NOT NULL,
  -- Slots de 30 minutos (hh:00 / hh:30).
  hora             time NOT NULL CHECK (extract(minute FROM hora) IN (0, 30) AND extract(second FROM hora) = 0),
  estado           text NOT NULL DEFAULT 'Pendiente'
                   CHECK (estado IN ('Pendiente', 'Confirmado', 'Aplazado', 'Cumplida', 'Ausente')),
  resultado        text CHECK (length(resultado) <= 1000),
  tipo             text NOT NULL DEFAULT 'normal' CHECK (tipo IN ('normal', 'control', 'reagendada')),
  cita_origen_id   uuid REFERENCES citas(id),
  usuario_id       uuid NOT NULL REFERENCES users(id),
  created_by       uuid REFERENCES users(id),
  updated_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (tipo = 'normal' OR cita_origen_id IS NOT NULL)
);
-- Bloqueo de slots: una sola cita vigente por fecha y hora (las aplazadas liberan el slot).
CREATE UNIQUE INDEX citas_slot_uq ON citas (organization_id, fecha, hora) WHERE estado <> 'Aplazado';
CREATE INDEX citas_org_fecha_idx ON citas (organization_id, fecha);
CREATE INDEX citas_colaborador_idx ON citas (colaborador_id, fecha);
CREATE INDEX citas_paciente_idx ON citas (paciente_id);

CREATE FUNCTION citas_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app_assert_same_org('pacientes', NEW.paciente_id, NEW.organization_id);
  PERFORM app_assert_same_org('servicios', NEW.servicio_id, NEW.organization_id);
  PERFORM app_assert_same_org('citas', NEW.cita_origen_id, NEW.organization_id);
  PERFORM app_assert_colaborador(NEW.colaborador_id, NEW.organization_id);

  IF TG_OP = 'INSERT' THEN
    NEW.usuario_id := coalesce(app_current_user_id(), NEW.usuario_id);
    IF NEW.estado NOT IN ('Pendiente', 'Confirmado') THEN
      RAISE EXCEPTION 'Una cita nueva debe estar Pendiente o Confirmada' USING ERRCODE = '23514';
    END IF;
    IF (NEW.fecha + NEW.hora) < (now() AT TIME ZONE 'America/Bogota') THEN
      RAISE EXCEPTION 'No se puede agendar en una fecha u hora pasada' USING ERRCODE = '23514';
    END IF;
  ELSE
    NEW.usuario_id := OLD.usuario_id;
    NEW.paciente_id := OLD.paciente_id;
    IF OLD.estado IN ('Aplazado', 'Cumplida', 'Ausente') AND NEW.estado <> OLD.estado THEN
      RAISE EXCEPTION 'La cita ya fue cerrada (%)', OLD.estado USING ERRCODE = '23514';
    END IF;
    IF OLD.estado IN ('Aplazado', 'Cumplida', 'Ausente') AND (NEW.fecha <> OLD.fecha OR NEW.hora <> OLD.hora) THEN
      RAISE EXCEPTION 'No se puede mover una cita cerrada' USING ERRCODE = '23514';
    END IF;
    IF NEW.estado IN ('Cumplida', 'Ausente') AND NEW.estado <> OLD.estado AND NEW.fecha > app_today() THEN
      RAISE EXCEPTION 'Una cita futura no puede marcarse como %', NEW.estado USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER citas_guard BEFORE INSERT OR UPDATE ON citas FOR EACH ROW EXECUTE FUNCTION citas_guard();
CREATE TRIGGER citas_stamp BEFORE INSERT OR UPDATE ON citas FOR EACH ROW EXECUTE FUNCTION catalog_stamp();
CREATE TRIGGER citas_no_delete BEFORE DELETE ON citas FOR EACH ROW EXECUTE FUNCTION catalog_no_delete();

-- ===========================================================================
-- Servicios realizados (+ historial inmutable)
-- ===========================================================================
CREATE TABLE servicios_realizados (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  paciente_id           uuid NOT NULL REFERENCES pacientes(id),
  servicio_id           uuid NOT NULL REFERENCES servicios(id),
  colaborador_id        uuid NOT NULL REFERENCES users(id),
  fecha                 date NOT NULL,
  convenio_id           uuid REFERENCES convenios(id),
  -- Valores congelados al registrar (no cambian si luego cambia el catálogo).
  valor_lista           numeric(14, 2) NOT NULL CHECK (valor_lista >= 0),
  descuento_pct         numeric(5, 2) NOT NULL DEFAULT 0 CHECK (descuento_pct BETWEEN 0 AND 100),
  valor_cobrado         numeric(14, 2) NOT NULL CHECK (valor_cobrado >= 0),
  costo_aplicado        numeric(14, 2) NOT NULL CHECK (costo_aplicado >= 0),
  puntos                integer NOT NULL CHECK (puntos >= 0),
  valor_manual          boolean NOT NULL DEFAULT false,
  motivo_valor_manual   text CHECK (length(motivo_valor_manual) <= 300),
  estado                text NOT NULL DEFAULT 'registrado' CHECK (estado IN ('registrado', 'anulado')),
  motivo_anulacion      text CHECK (length(motivo_anulacion) <= 300),
  usuario_registro_id   uuid NOT NULL REFERENCES users(id),
  created_by            uuid REFERENCES users(id),
  updated_by            uuid REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT valor_manual OR length(btrim(coalesce(motivo_valor_manual, ''))) >= 5),
  CHECK (estado <> 'anulado' OR length(btrim(coalesce(motivo_anulacion, ''))) >= 5)
);
CREATE INDEX servicios_realizados_org_fecha_idx ON servicios_realizados (organization_id, fecha);
CREATE INDEX servicios_realizados_colab_fecha_idx ON servicios_realizados (colaborador_id, fecha);
CREATE INDEX servicios_realizados_paciente_idx ON servicios_realizados (paciente_id);

CREATE FUNCTION servicios_realizados_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app_assert_same_org('pacientes', NEW.paciente_id, NEW.organization_id);
  PERFORM app_assert_same_org('servicios', NEW.servicio_id, NEW.organization_id);
  PERFORM app_assert_same_org('convenios', NEW.convenio_id, NEW.organization_id);
  PERFORM app_assert_colaborador(NEW.colaborador_id, NEW.organization_id);

  IF NEW.fecha > app_today() THEN
    RAISE EXCEPTION 'La fecha del servicio no puede ser futura' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.usuario_registro_id := coalesce(app_current_user_id(), NEW.usuario_registro_id);
  ELSE
    NEW.usuario_registro_id := OLD.usuario_registro_id;
    NEW.paciente_id := OLD.paciente_id;
    IF OLD.estado = 'anulado' THEN
      RAISE EXCEPTION 'Un servicio anulado no se puede modificar' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER servicios_realizados_guard BEFORE INSERT OR UPDATE ON servicios_realizados
  FOR EACH ROW EXECUTE FUNCTION servicios_realizados_guard();
CREATE TRIGGER servicios_realizados_stamp BEFORE INSERT OR UPDATE ON servicios_realizados
  FOR EACH ROW EXECUTE FUNCTION catalog_stamp();
CREATE TRIGGER servicios_realizados_no_delete BEFORE DELETE ON servicios_realizados
  FOR EACH ROW EXECUTE FUNCTION catalog_no_delete();

CREATE TABLE servicios_realizados_historial (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  servicio_realizado_id  uuid NOT NULL REFERENCES servicios_realizados(id),
  organization_id        uuid NOT NULL REFERENCES organizations(id),
  operacion              text NOT NULL CHECK (operacion IN ('INSERT', 'UPDATE')),
  datos                  jsonb NOT NULL,
  usuario_id             uuid REFERENCES users(id),
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX servicios_realizados_historial_sr_idx ON servicios_realizados_historial (servicio_realizado_id);

CREATE FUNCTION servicios_realizados_historial_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO servicios_realizados_historial (servicio_realizado_id, organization_id, operacion, datos, usuario_id)
  VALUES (NEW.id, NEW.organization_id, TG_OP, to_jsonb(NEW), coalesce(app_current_user_id(), NEW.updated_by));
  RETURN NULL;
END $$;

CREATE TRIGGER servicios_realizados_historial AFTER INSERT OR UPDATE ON servicios_realizados
  FOR EACH ROW EXECUTE FUNCTION servicios_realizados_historial_write();
CREATE TRIGGER servicios_realizados_historial_no_update BEFORE UPDATE OR DELETE ON servicios_realizados_historial
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
CREATE TRIGGER servicios_realizados_historial_no_truncate BEFORE TRUNCATE ON servicios_realizados_historial
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();

-- ===========================================================================
-- Cierres de inasistencia (inmutables)
-- ===========================================================================
CREATE TABLE cierres_ausencia (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  cita_id             uuid NOT NULL UNIQUE REFERENCES citas(id),
  motivo              text NOT NULL CHECK (motivo IN ('Imprevisto', 'Falta de dinero', 'Tiempo', 'No recordaba', 'Otros')),
  observacion         text CHECK (length(observacion) <= 1000),
  canal_contacto      text NOT NULL CHECK (canal_contacto IN ('Llamada', 'WhatsApp', 'SMS', 'Correo electrónico', 'Presencial')),
  fecha               timestamptz NOT NULL DEFAULT now(),
  usuario_id          uuid NOT NULL REFERENCES users(id),
  reagendo            boolean NOT NULL DEFAULT false,
  cita_reagendada_id  uuid REFERENCES citas(id),
  CHECK (reagendo = (cita_reagendada_id IS NOT NULL)),
  CHECK (motivo <> 'Otros' OR length(btrim(coalesce(observacion, ''))) >= 3)
);

CREATE FUNCTION cierres_ausencia_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM citas WHERE id = NEW.cita_id AND organization_id = NEW.organization_id AND estado = 'Ausente') THEN
    RAISE EXCEPTION 'Solo se cierran citas marcadas como Ausente' USING ERRCODE = '23514';
  END IF;
  PERFORM app_assert_same_org('citas', NEW.cita_reagendada_id, NEW.organization_id);
  NEW.usuario_id := coalesce(app_current_user_id(), NEW.usuario_id);
  NEW.fecha := now();
  RETURN NEW;
END $$;

CREATE TRIGGER cierres_ausencia_guard BEFORE INSERT ON cierres_ausencia
  FOR EACH ROW EXECUTE FUNCTION cierres_ausencia_guard();
CREATE TRIGGER cierres_ausencia_immutable BEFORE UPDATE OR DELETE ON cierres_ausencia
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

-- ===========================================================================
-- Metas de colaboradores y configuración de recurrencia
-- ===========================================================================
CREATE TABLE metas_colaborador (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  colaborador_id         uuid NOT NULL REFERENCES users(id),
  anio                   integer NOT NULL CHECK (anio BETWEEN 2020 AND 2100),
  mes                    integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  meta_puntos            integer NOT NULL CHECK (meta_puntos > 0),
  meta_dinero            numeric(14, 2) NOT NULL CHECK (meta_dinero >= 0),
  valor_punto_adicional  numeric(14, 2) NOT NULL CHECK (valor_punto_adicional >= 0),
  -- [s1, s2, s3, s4] ajustada por el gerente; NULL = propuesta automática.
  distribucion_semanal   jsonb CHECK (distribucion_semanal IS NULL OR
                                      (jsonb_typeof(distribucion_semanal) = 'array' AND jsonb_array_length(distribucion_semanal) = 4)),
  created_by             uuid REFERENCES users(id),
  updated_by             uuid REFERENCES users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT metas_colaborador_uq UNIQUE (organization_id, colaborador_id, anio, mes)
);

CREATE FUNCTION metas_colaborador_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app_assert_colaborador(NEW.colaborador_id, NEW.organization_id);
  IF NEW.distribucion_semanal IS NOT NULL AND
     (SELECT sum(value::numeric) FROM jsonb_array_elements_text(NEW.distribucion_semanal)) <> NEW.meta_puntos THEN
    RAISE EXCEPTION 'La distribución semanal debe sumar la meta mensual' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER metas_colaborador_guard BEFORE INSERT OR UPDATE ON metas_colaborador
  FOR EACH ROW EXECUTE FUNCTION metas_colaborador_guard();
CREATE TRIGGER metas_colaborador_stamp BEFORE INSERT OR UPDATE ON metas_colaborador
  FOR EACH ROW EXECUTE FUNCTION catalog_stamp();
CREATE TRIGGER metas_colaborador_no_delete BEFORE DELETE ON metas_colaborador
  FOR EACH ROW EXECUTE FUNCTION catalog_no_delete();

CREATE TABLE configuracion_recurrencia (
  organization_id  uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
  puntos_nivel_60  integer NOT NULL DEFAULT 0 CHECK (puntos_nivel_60 >= 0),
  puntos_nivel_80  integer NOT NULL DEFAULT 0 CHECK (puntos_nivel_80 >= 0),
  updated_by       uuid REFERENCES users(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (puntos_nivel_80 >= puntos_nivel_60)
);

CREATE FUNCTION configuracion_recurrencia_stamp() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_by := coalesce(app_current_user_id(), NEW.updated_by);
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER configuracion_recurrencia_stamp BEFORE INSERT OR UPDATE ON configuracion_recurrencia
  FOR EACH ROW EXECUTE FUNCTION configuracion_recurrencia_stamp();

-- ===========================================================================
-- Tasa de recurrencia global (solo cifras agregadas; accesible a todo rol
-- autenticado aunque RLS le oculte las filas individuales).
-- Base: pacientes atendidos el mes anterior. Retornan: de ellos, los atendidos
-- en el mes consultado.
-- ===========================================================================
CREATE FUNCTION app_recurrence_rate(p_anio integer, p_mes integer)
RETURNS TABLE (base integer, retornan integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH b AS (SELECT make_date(p_anio, p_mes, 1) AS d, app_current_org_id() AS org),
  prev AS (
    SELECT DISTINCT sr.paciente_id FROM servicios_realizados sr, b
    WHERE sr.organization_id = b.org AND sr.estado = 'registrado'
      AND sr.fecha >= (b.d - interval '1 month')::date AND sr.fecha < b.d
  ),
  cur AS (
    SELECT DISTINCT sr.paciente_id FROM servicios_realizados sr, b
    WHERE sr.organization_id = b.org AND sr.estado = 'registrado'
      AND sr.fecha >= b.d AND sr.fecha < (b.d + interval '1 month')::date
  )
  SELECT (SELECT count(*) FROM prev)::int,
         (SELECT count(*) FROM prev JOIN cur USING (paciente_id))::int
  WHERE app_current_org_id() IS NOT NULL
$$;
REVOKE ALL ON FUNCTION app_recurrence_rate(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_recurrence_rate(integer, integer) TO crm_app;

-- ===========================================================================
-- RLS
-- ===========================================================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pacientes', 'citas', 'servicios_realizados', 'servicios_realizados_historial',
                           'cierres_ausencia', 'metas_colaborador', 'configuracion_recurrencia'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

CREATE POLICY pacientes_select ON pacientes FOR SELECT TO crm_app
  USING (organization_id = app_current_org_id() AND app_is_staff());
CREATE POLICY pacientes_insert ON pacientes FOR INSERT TO crm_app
  WITH CHECK (organization_id = app_current_org_id() AND app_is_staff());
CREATE POLICY pacientes_update ON pacientes FOR UPDATE TO crm_app
  USING (organization_id = app_current_org_id() AND app_is_staff())
  WITH CHECK (organization_id = app_current_org_id());

CREATE POLICY citas_select ON citas FOR SELECT TO crm_app
  USING (organization_id = app_current_org_id() AND (app_is_staff() OR colaborador_id = app_current_user_id()));
CREATE POLICY citas_insert ON citas FOR INSERT TO crm_app
  WITH CHECK (organization_id = app_current_org_id() AND app_is_staff());
CREATE POLICY citas_update ON citas FOR UPDATE TO crm_app
  USING (organization_id = app_current_org_id() AND app_is_staff())
  WITH CHECK (organization_id = app_current_org_id());

CREATE POLICY servicios_realizados_select ON servicios_realizados FOR SELECT TO crm_app
  USING (organization_id = app_current_org_id() AND (app_is_staff() OR colaborador_id = app_current_user_id()));
CREATE POLICY servicios_realizados_insert ON servicios_realizados FOR INSERT TO crm_app
  WITH CHECK (organization_id = app_current_org_id() AND app_is_staff());
CREATE POLICY servicios_realizados_update ON servicios_realizados FOR UPDATE TO crm_app
  USING (organization_id = app_current_org_id() AND app_is_staff())
  WITH CHECK (organization_id = app_current_org_id());

CREATE POLICY servicios_realizados_historial_select ON servicios_realizados_historial FOR SELECT TO crm_app
  USING (organization_id = app_current_org_id() AND app_is_staff());

CREATE POLICY cierres_ausencia_select ON cierres_ausencia FOR SELECT TO crm_app
  USING (organization_id = app_current_org_id() AND app_is_staff());
CREATE POLICY cierres_ausencia_insert ON cierres_ausencia FOR INSERT TO crm_app
  WITH CHECK (organization_id = app_current_org_id() AND app_is_staff());

CREATE POLICY metas_colaborador_select ON metas_colaborador FOR SELECT TO crm_app
  USING (organization_id = app_current_org_id() AND (app_is_admin() OR colaborador_id = app_current_user_id()));
CREATE POLICY metas_colaborador_insert ON metas_colaborador FOR INSERT TO crm_app
  WITH CHECK (organization_id = app_current_org_id() AND app_is_admin());
CREATE POLICY metas_colaborador_update ON metas_colaborador FOR UPDATE TO crm_app
  USING (organization_id = app_current_org_id() AND app_is_admin())
  WITH CHECK (organization_id = app_current_org_id());

CREATE POLICY configuracion_recurrencia_select ON configuracion_recurrencia FOR SELECT TO crm_app
  USING (organization_id = app_current_org_id());
CREATE POLICY configuracion_recurrencia_insert ON configuracion_recurrencia FOR INSERT TO crm_app
  WITH CHECK (organization_id = app_current_org_id() AND app_is_admin());
CREATE POLICY configuracion_recurrencia_update ON configuracion_recurrencia FOR UPDATE TO crm_app
  USING (organization_id = app_current_org_id() AND app_is_admin())
  WITH CHECK (organization_id = app_current_org_id());

GRANT SELECT, INSERT, UPDATE ON pacientes, citas, servicios_realizados, metas_colaborador, configuracion_recurrencia TO crm_app;
GRANT SELECT, INSERT ON cierres_ausencia TO crm_app;
GRANT SELECT ON servicios_realizados_historial TO crm_app;
