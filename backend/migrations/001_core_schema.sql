-- 001: Organizaciones, usuarios y funciones de contexto para RLS.
-- Requisito: el rol crm_app ya existe (lo crea scripts/migrate.js).

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO crm_app;

CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,64}$'),
  name        text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  email                 text NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
  full_name             text NOT NULL CHECK (length(full_name) BETWEEN 2 AND 200),
  -- Debe coincidir con las claves de matrix.json (verificado por test).
  role                  text NOT NULL CHECK (role IN ('Super Admin', 'Gerente', 'Asistente', 'Colaborador')),
  password_hash         text NOT NULL,
  is_active             boolean NOT NULL DEFAULT true,
  must_change_password  boolean NOT NULL DEFAULT false,
  -- Se incrementa en cambios de rol / contraseña / desactivación: invalida access tokens.
  token_version         integer NOT NULL DEFAULT 0,
  last_login_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_unique UNIQUE (email)
);
CREATE INDEX users_org_idx ON users (organization_id);

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Contexto de identidad (fijado por la app con set_config(..., true) = SET LOCAL)
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

-- SECURITY DEFINER para leer users sin recursión de políticas RLS.
CREATE FUNCTION app_current_org_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT organization_id FROM users WHERE id = app_current_user_id() AND is_active
$$;

CREATE FUNCTION app_current_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT role FROM users WHERE id = app_current_user_id() AND is_active
$$;

CREATE FUNCTION app_is_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(app_current_role() IN ('Super Admin', 'Gerente'), false)
$$;

REVOKE ALL ON FUNCTION app_current_org_id(), app_current_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_current_user_id(), app_current_org_id(), app_current_role(), app_is_admin() TO crm_app;

-- ---------------------------------------------------------------------------
-- Guardas de escalamiento de privilegios en users (además de RLS).
-- Sin identidad (seed/migraciones como dueño) no aplica; crm_app sin identidad
-- no ve filas por RLS.
-- ---------------------------------------------------------------------------
CREATE FUNCTION users_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor_role text := app_current_role();
BEGIN
  IF app_current_user_id() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.organization_id <> OLD.organization_id THEN
    RAISE EXCEPTION 'No se permite mover usuarios entre organizaciones' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE'
     AND (NEW.role IS DISTINCT FROM OLD.role OR NEW.is_active IS DISTINCT FROM OLD.is_active)
     AND NOT app_is_admin() THEN
    RAISE EXCEPTION 'Cambio de rol/estado no autorizado' USING ERRCODE = '42501';
  END IF;

  -- Solo un Super Admin crea, modifica o asigna el rol Super Admin.
  IF (NEW.role = 'Super Admin' OR (TG_OP = 'UPDATE' AND OLD.role = 'Super Admin'))
     AND actor_role IS DISTINCT FROM 'Super Admin' THEN
    RAISE EXCEPTION 'Operación sobre Super Admin no autorizada' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER users_guard BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION users_guard();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY organizations_select ON organizations FOR SELECT TO crm_app
  USING (id = app_current_org_id());
CREATE POLICY organizations_update ON organizations FOR UPDATE TO crm_app
  USING (id = app_current_org_id() AND app_current_role() = 'Super Admin')
  WITH CHECK (id = app_current_org_id());

CREATE POLICY users_select ON users FOR SELECT TO crm_app
  USING (organization_id = app_current_org_id());
CREATE POLICY users_insert ON users FOR INSERT TO crm_app
  WITH CHECK (organization_id = app_current_org_id() AND app_is_admin());
CREATE POLICY users_update ON users FOR UPDATE TO crm_app
  USING (organization_id = app_current_org_id() AND (id = app_current_user_id() OR app_is_admin()))
  WITH CHECK (organization_id = app_current_org_id());
-- Sin política DELETE: los usuarios se desactivan, no se eliminan.

GRANT SELECT, UPDATE (name) ON organizations TO crm_app;
GRANT SELECT ON users TO crm_app;
GRANT INSERT (organization_id, email, full_name, role, password_hash, must_change_password) ON users TO crm_app;
GRANT UPDATE (full_name, role, password_hash, is_active, must_change_password, token_version, last_login_at) ON users TO crm_app;
