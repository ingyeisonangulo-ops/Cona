-- 003: Bitácora de auditoría inmutable, filtrada por organización.

CREATE TABLE audit_logs (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id  uuid REFERENCES organizations(id) ON DELETE RESTRICT,  -- NULL: evento sin organización (p. ej. login a cuenta inexistente)
  actor_user_id    uuid REFERENCES users(id) ON DELETE RESTRICT,
  action           text NOT NULL CHECK (action ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  entity_type      text,
  entity_id        text,
  ip               text,
  user_agent       text,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_org_created_idx ON audit_logs (organization_id, created_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs (action);

-- Inmutabilidad: ni siquiera el dueño puede modificar o borrar filas.
CREATE FUNCTION audit_logs_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs es inmutable' USING ERRCODE = '42501';
END $$;

CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_logs_select ON audit_logs FOR SELECT TO crm_app
  USING (organization_id = app_current_org_id() AND app_is_admin());

GRANT SELECT ON audit_logs TO crm_app;
-- Sin INSERT directo: toda escritura pasa por app_audit_log().

-- Con identidad en contexto, la organización y el actor se toman de la sesión
-- (no se pueden suplantar desde la app). Sin identidad (login, refresh, seed),
-- se usan los parámetros.
CREATE FUNCTION app_audit_log(
  p_action text, p_organization_id uuid, p_actor_user_id uuid,
  p_entity_type text, p_entity_id text, p_ip text, p_user_agent text, p_metadata jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id bigint;
  v_org uuid := p_organization_id;
  v_actor uuid := p_actor_user_id;
BEGIN
  IF app_current_user_id() IS NOT NULL THEN
    v_actor := app_current_user_id();
    v_org := (SELECT organization_id FROM users WHERE id = v_actor);
  END IF;

  INSERT INTO audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, ip, user_agent, metadata)
  VALUES (v_org, v_actor, p_action, p_entity_type, p_entity_id, p_ip, left(p_user_agent, 400),
          coalesce(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION app_audit_log(text, uuid, uuid, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_audit_log(text, uuid, uuid, text, text, text, text, jsonb) TO crm_app;
