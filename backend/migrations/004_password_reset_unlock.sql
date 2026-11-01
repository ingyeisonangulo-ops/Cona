-- 004: Recuperación de contraseña por enlace de un solo uso, desbloqueo de
-- cuentas y estado de bloqueo visible para administradores.

CREATE TABLE password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,      -- SHA-256; el token solo se muestra una vez
  created_by  uuid REFERENCES users(id),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id);

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens FORCE ROW LEVEL SECURITY;
-- Sin políticas ni GRANT: solo vía funciones.

-- Verifica que el usuario actual sea administrador de la organización del objetivo
-- y que un Gerente no actúe sobre un Super Admin.
CREATE FUNCTION app_can_manage_user(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT app_is_admin()
       AND u.organization_id = app_current_org_id()
       AND (u.role <> 'Super Admin' OR app_current_role() = 'Super Admin')
    FROM users u WHERE u.id = p_user_id
  ), false)
$$;

CREATE FUNCTION auth_create_reset_token(p_user_id uuid, p_token_hash text, p_ttl interval)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_expires timestamptz := now() + p_ttl;
BEGIN
  IF NOT app_can_manage_user(p_user_id) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  -- Un solo enlace vigente por usuario.
  UPDATE password_reset_tokens SET used_at = now() WHERE user_id = p_user_id AND used_at IS NULL;
  INSERT INTO password_reset_tokens (user_id, token_hash, created_by, expires_at)
  VALUES (p_user_id, p_token_hash, app_current_user_id(), v_expires);
  RETURN v_expires;
END $$;

-- Consume el enlace: fija la nueva contraseña, invalida access tokens
-- (token_version) y revoca todas las sesiones (refresh tokens).
CREATE FUNCTION auth_consume_reset_token(p_token_hash text, p_password_hash text)
RETURNS TABLE (user_id uuid, organization_id uuid, email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  t password_reset_tokens%ROWTYPE;
  u users%ROWTYPE;
BEGIN
  SELECT * INTO t FROM password_reset_tokens WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR t.used_at IS NOT NULL OR t.expires_at <= now() THEN
    RETURN;
  END IF;
  SELECT * INTO u FROM users WHERE id = t.user_id AND is_active;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE password_reset_tokens SET used_at = now() WHERE user_id = t.user_id AND used_at IS NULL;
  UPDATE users SET password_hash = p_password_hash, must_change_password = false,
                   token_version = token_version + 1
  WHERE id = t.user_id;
  UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = t.user_id AND revoked_at IS NULL;
  DELETE FROM auth_throttle WHERE kind = 'account' AND key = u.email;

  RETURN QUERY SELECT u.id, u.organization_id, u.email;
END $$;

CREATE FUNCTION auth_unlock_user(p_user_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT app_can_manage_user(p_user_id) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  DELETE FROM auth_throttle
  WHERE kind = 'account' AND key = (SELECT email FROM users WHERE id = p_user_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END $$;

-- Cuentas bloqueadas de la organización actual (solo administradores).
CREATE FUNCTION app_org_locked_users() RETURNS TABLE (user_id uuid, locked_until timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, t.locked_until
  FROM users u
  JOIN auth_throttle t ON t.kind = 'account' AND t.key = u.email
  WHERE app_is_admin()
    AND u.organization_id = app_current_org_id()
    AND t.locked_until > now()
$$;

REVOKE ALL ON FUNCTION
  app_can_manage_user(uuid), auth_create_reset_token(uuid, text, interval),
  auth_consume_reset_token(text, text), auth_unlock_user(uuid), app_org_locked_users()
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  app_can_manage_user(uuid), auth_create_reset_token(uuid, text, interval),
  auth_consume_reset_token(text, text), auth_unlock_user(uuid), app_org_locked_users()
TO crm_app;
