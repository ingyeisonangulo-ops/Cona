-- 008: Cargos del personal clínico y servicios por cargo.
--
-- El ROL sigue definiendo los permisos (matrix.json, sin cambios). El CARGO
-- dice qué servicios ejecuta cada persona:
--   * Colaborador → Odontólogo, Higienista, Auxiliar o Especialista (obligatorio).
--   * Asistente   → cargo "Asistente": también ejecuta servicios, tiene metas y
--                   aparece como colaboradora en el registro y el desempeño.
--   * Gerente / Super Admin → sin cargo (no ejecutan servicios).
-- Cada servicio declara los cargos que lo realizan (`servicios.cargos`); la
-- base de datos rechaza registrar o agendar un servicio con alguien de otro cargo.
--
-- Datos existentes: los Colaboradores quedan como Odontólogo y los servicios
-- con todos los cargos, para no invalidar nada; el Gerente los ajusta luego.

-- ---------------------------------------------------------------- Usuarios
ALTER TABLE users ADD COLUMN cargo text
  CHECK (cargo IN ('Odontólogo', 'Higienista', 'Auxiliar', 'Especialista', 'Asistente'));

UPDATE users SET cargo = 'Odontólogo' WHERE role = 'Colaborador';
UPDATE users SET cargo = 'Asistente' WHERE role = 'Asistente';

-- El cargo se normaliza según el rol (Asistente fijo; Gerente/Super Admin sin cargo).
CREATE FUNCTION users_cargo_normalize() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role = 'Asistente' THEN
    NEW.cargo := 'Asistente';
  ELSIF NEW.role IN ('Gerente', 'Super Admin') THEN
    NEW.cargo := NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.cargo IS DISTINCT FROM OLD.cargo
     AND app_current_user_id() IS NOT NULL AND NOT app_is_admin() THEN
    RAISE EXCEPTION 'Cambio de cargo no autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
-- El nombre ordena este trigger después de users_guard (los BEFORE se ejecutan
-- en orden alfabético): un cambio de rol no autorizado reporta ese error primero.
CREATE TRIGGER users_guard_cargo BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION users_cargo_normalize();

ALTER TABLE users ADD CONSTRAINT users_cargo_por_rol CHECK (
  (role = 'Colaborador' AND cargo IN ('Odontólogo', 'Higienista', 'Auxiliar', 'Especialista'))
  OR (role = 'Asistente' AND cargo = 'Asistente')
  OR (role IN ('Gerente', 'Super Admin') AND cargo IS NULL)
);

GRANT INSERT (cargo), UPDATE (cargo) ON users TO crm_app;

-- La sesión expone el cargo (perfil y filtro del catálogo del Colaborador).
DROP FUNCTION auth_session_user(uuid);
CREATE FUNCTION auth_session_user(p_user_id uuid)
RETURNS TABLE (id uuid, organization_id uuid, email text, full_name text, role text, cargo text,
               is_active boolean, must_change_password boolean, token_version integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.organization_id, u.email, u.full_name, u.role, u.cargo, u.is_active,
         u.must_change_password, u.token_version
  FROM users u WHERE u.id = p_user_id
$$;
REVOKE ALL ON FUNCTION auth_session_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_session_user(uuid) TO crm_app;

-- La Asistente también es colaboradora (servicios realizados, citas y metas).
CREATE OR REPLACE FUNCTION app_assert_colaborador(p_user_id uuid, p_org uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND organization_id = p_org
                 AND role IN ('Colaborador', 'Asistente') AND is_active) THEN
    RAISE EXCEPTION 'El colaborador no es válido' USING ERRCODE = '23503';
  END IF;
END $$;

-- ---------------------------------------------------------------- Servicios
ALTER TABLE servicios ADD COLUMN cargos text[] NOT NULL
  DEFAULT ARRAY['Odontólogo', 'Higienista', 'Auxiliar', 'Especialista', 'Asistente']
  CHECK (cardinality(cargos) >= 1
         AND cargos <@ ARRAY['Odontólogo', 'Higienista', 'Auxiliar', 'Especialista', 'Asistente']);
CREATE INDEX servicios_cargos_idx ON servicios USING gin (cargos);

-- El colaborador debe tener un cargo que realice el servicio.
CREATE FUNCTION app_assert_cargo_servicio(p_colaborador uuid, p_servicio uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_colaborador IS NULL OR p_servicio IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM users u JOIN servicios s ON s.id = p_servicio
                 WHERE u.id = p_colaborador AND u.cargo = ANY (s.cargos)) THEN
    RAISE EXCEPTION 'El colaborador seleccionado no realiza este servicio según su cargo' USING ERRCODE = '23514';
  END IF;
END $$;
REVOKE ALL ON FUNCTION app_assert_cargo_servicio(uuid, uuid) FROM PUBLIC;

CREATE FUNCTION cargo_servicio_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app_assert_cargo_servicio(NEW.colaborador_id, NEW.servicio_id);
  RETURN NEW;
END $$;

-- Solo al crear o al cambiar servicio/colaborador: anular o cambiar el estado
-- de registros antiguos sigue funcionando aunque luego cambien los cargos.
CREATE TRIGGER servicios_realizados_cargo BEFORE INSERT OR UPDATE OF servicio_id, colaborador_id
  ON servicios_realizados FOR EACH ROW EXECUTE FUNCTION cargo_servicio_guard();
CREATE TRIGGER citas_cargo BEFORE INSERT OR UPDATE OF servicio_id, colaborador_id
  ON citas FOR EACH ROW EXECUTE FUNCTION cargo_servicio_guard();
