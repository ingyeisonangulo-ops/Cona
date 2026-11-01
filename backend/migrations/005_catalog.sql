-- 005: Módulo patrón de negocio — Categorías, Servicios y Convenios.
-- Desactivación lógica (status), sin borrado físico. Lectura para la
-- organización; escritura solo para Super Admin y Gerente (además del control
-- de permisos en el backend).

CREATE TABLE categorias (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  nombre           text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 2 AND 120),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by       uuid REFERENCES users(id),
  updated_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categorias_org_nombre_uq ON categorias (organization_id, lower(nombre));

CREATE TABLE servicios (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  categoria_id     uuid NOT NULL REFERENCES categorias(id) ON DELETE RESTRICT,
  nombre           text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 2 AND 160),
  valor_publico    numeric(14, 2) NOT NULL CHECK (valor_publico >= 0),
  costo_clinica    numeric(14, 2) NOT NULL CHECK (costo_clinica >= 0),
  puntos           integer NOT NULL DEFAULT 0 CHECK (puntos >= 0),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by       uuid REFERENCES users(id),
  updated_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX servicios_org_nombre_uq ON servicios (organization_id, lower(nombre));
CREATE INDEX servicios_categoria_idx ON servicios (categoria_id);

CREATE TABLE convenios (
  id                               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id                  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  nombre                           text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 2 AND 160),
  entidad                          text NOT NULL CHECK (length(btrim(entidad)) BETWEEN 2 AND 200),
  -- { "<categoria_id>": <porcentaje 0..100>, ... }
  porcentaje_descuento_categoria   jsonb NOT NULL DEFAULT '{}'::jsonb
                                   CHECK (jsonb_typeof(porcentaje_descuento_categoria) = 'object'),
  status                           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by                       uuid REFERENCES users(id),
  updated_by                       uuid REFERENCES users(id),
  created_at                       timestamptz NOT NULL DEFAULT now(),
  updated_at                       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX convenios_org_nombre_uq ON convenios (organization_id, lower(nombre));

-- La categoría de un servicio debe pertenecer a la misma organización.
CREATE FUNCTION servicios_same_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM categorias c WHERE c.id = NEW.categoria_id AND c.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'La categoría no pertenece a la organización' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER servicios_same_org BEFORE INSERT OR UPDATE OF categoria_id, organization_id ON servicios
  FOR EACH ROW EXECUTE FUNCTION servicios_same_org();

-- Auditoría de columnas y prohibición de borrado físico.
CREATE FUNCTION catalog_stamp() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := coalesce(app_current_user_id(), NEW.created_by);
  ELSE
    IF NEW.organization_id <> OLD.organization_id THEN
      RAISE EXCEPTION 'No se permite cambiar la organización' USING ERRCODE = '42501';
    END IF;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.updated_by := coalesce(app_current_user_id(), NEW.updated_by);
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE FUNCTION catalog_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Use desactivación lógica (status = inactive)' USING ERRCODE = '42501';
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['categorias', 'servicios', 'convenios'] LOOP
    EXECUTE format('CREATE TRIGGER %1$s_stamp BEFORE INSERT OR UPDATE ON %1$I FOR EACH ROW EXECUTE FUNCTION catalog_stamp()', t);
    EXECUTE format('CREATE TRIGGER %1$s_no_delete BEFORE DELETE ON %1$I FOR EACH ROW EXECUTE FUNCTION catalog_no_delete()', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %1$s_select ON %1$I FOR SELECT TO crm_app USING (organization_id = app_current_org_id())', t);
    EXECUTE format('CREATE POLICY %1$s_insert ON %1$I FOR INSERT TO crm_app WITH CHECK (organization_id = app_current_org_id() AND app_is_admin())', t);
    EXECUTE format('CREATE POLICY %1$s_update ON %1$I FOR UPDATE TO crm_app USING (organization_id = app_current_org_id() AND app_is_admin()) WITH CHECK (organization_id = app_current_org_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO crm_app', t);
  END LOOP;
END $$;
