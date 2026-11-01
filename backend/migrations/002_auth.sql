-- 002: Refresh tokens rotativos, bloqueo por intentos y funciones de autenticación.
-- Las operaciones previas a conocer la identidad (login, refresh) solo son
-- posibles mediante funciones SECURITY DEFINER acotadas; crm_app no tiene
-- acceso directo a auth_throttle ni puede leer password_hash de otros por RLS.

CREATE TABLE refresh_tokens (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id          uuid NOT NULL,
  token_hash         text NOT NULL UNIQUE,          -- SHA-256 del token; nunca el token
  expires_at         timestamptz NOT NULL,
  family_expires_at  timestamptz NOT NULL,          -- vida máxima absoluta de la sesión
  revoked_at         timestamptz,
  replaced_by        uuid REFERENCES refresh_tokens(id),
  ip                 text,
  user_agent         text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY refresh_tokens_own ON refresh_tokens FOR SELECT TO crm_app
  USING (user_id = app_current_user_id());
GRANT SELECT ON refresh_tokens TO crm_app;

CREATE TABLE auth_throttle (
  kind             text NOT NULL CHECK (kind IN ('account', 'ip')),
  key              text NOT NULL,
  failed_count     integer NOT NULL DEFAULT 0,
  first_failed_at  timestamptz NOT NULL DEFAULT now(),
  locked_until     timestamptz,
  PRIMARY KEY (kind, key)
);
ALTER TABLE auth_throttle ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_throttle FORCE ROW LEVEL SECURITY;
-- Sin políticas ni GRANT: solo accesible desde las funciones de abajo.

-- ---------------------------------------------------------------------------
CREATE FUNCTION auth_find_user_for_login(p_email text)
RETURNS TABLE (id uuid, organization_id uuid, role text, password_hash text, is_active boolean, token_version integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.organization_id, u.role, u.password_hash, u.is_active, u.token_version
  FROM users u WHERE u.email = lower(p_email)
$$;

CREATE FUNCTION auth_session_user(p_user_id uuid)
RETURNS TABLE (id uuid, organization_id uuid, email text, full_name text, role text,
               is_active boolean, must_change_password boolean, token_version integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.organization_id, u.email, u.full_name, u.role, u.is_active,
         u.must_change_password, u.token_version
  FROM users u WHERE u.id = p_user_id
$$;

CREATE FUNCTION auth_mark_login(p_user_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE users SET last_login_at = now() WHERE id = p_user_id
$$;

-- ---------------------------------------------------------------------------
-- Bloqueo por intentos (por cuenta y por IP)
-- ---------------------------------------------------------------------------
CREATE FUNCTION auth_throttle_check(p_account text, p_ip text) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT max(locked_until) FROM auth_throttle
  WHERE locked_until > now()
    AND ((kind = 'account' AND key = lower(p_account)) OR (kind = 'ip' AND key = p_ip))
$$;

CREATE FUNCTION auth_throttle_fail(
  p_account text, p_ip text, p_max_account integer, p_max_ip integer,
  p_window interval, p_lock interval
) RETURNS TABLE (account_locked boolean, ip_locked boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  k record;
  v_count integer;
  v_acc boolean := false;
  v_ip boolean := false;
BEGIN
  FOR k IN SELECT * FROM (VALUES ('account', lower(p_account), p_max_account), ('ip', p_ip, p_max_ip)) AS t(kind, key, max_attempts)
  LOOP
    CONTINUE WHEN k.key IS NULL;
    INSERT INTO auth_throttle AS t (kind, key, failed_count, first_failed_at)
    VALUES (k.kind, k.key, 1, now())
    ON CONFLICT (kind, key) DO UPDATE SET
      failed_count    = CASE WHEN t.first_failed_at < now() - p_window THEN 1 ELSE t.failed_count + 1 END,
      first_failed_at = CASE WHEN t.first_failed_at < now() - p_window THEN now() ELSE t.first_failed_at END
    RETURNING t.failed_count INTO v_count;

    IF v_count >= k.max_attempts THEN
      UPDATE auth_throttle SET locked_until = now() + p_lock, failed_count = 0, first_failed_at = now()
      WHERE kind = k.kind AND key = k.key;
      IF k.kind = 'account' THEN v_acc := true; ELSE v_ip := true; END IF;
    END IF;
  END LOOP;
  RETURN QUERY SELECT v_acc, v_ip;
END $$;

-- El éxito reinicia solo el contador de la cuenta, no el de la IP.
CREATE FUNCTION auth_throttle_success(p_account text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM auth_throttle WHERE kind = 'account' AND key = lower(p_account)
$$;

-- ---------------------------------------------------------------------------
-- Refresh tokens rotativos con detección de reutilización
-- ---------------------------------------------------------------------------
CREATE FUNCTION auth_issue_refresh_token(
  p_user_id uuid, p_token_hash text, p_ttl interval, p_family_ttl interval, p_ip text, p_ua text
) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, family_expires_at, ip, user_agent)
  VALUES (p_user_id, gen_random_uuid(), p_token_hash, now() + least(p_ttl, p_family_ttl),
          now() + p_family_ttl, p_ip, left(p_ua, 400))
  RETURNING id
$$;

CREATE FUNCTION auth_rotate_refresh_token(
  p_old_hash text, p_new_hash text, p_ttl interval, p_ip text, p_ua text
) RETURNS TABLE (status text, user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  t refresh_tokens%ROWTYPE;
  v_new uuid;
BEGIN
  SELECT * INTO t FROM refresh_tokens WHERE token_hash = p_old_hash FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid; RETURN;
  END IF;

  IF t.revoked_at IS NOT NULL THEN
    -- Token ya usado/revocado: posible robo. Se revoca toda la familia.
    UPDATE refresh_tokens SET revoked_at = now()
    WHERE family_id = t.family_id AND revoked_at IS NULL;
    RETURN QUERY SELECT 'reuse'::text, t.user_id; RETURN;
  END IF;

  IF t.expires_at <= now() OR t.family_expires_at <= now() THEN
    UPDATE refresh_tokens SET revoked_at = now() WHERE id = t.id;
    RETURN QUERY SELECT 'expired'::text, t.user_id; RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.user_id AND u.is_active) THEN
    UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = t.family_id AND revoked_at IS NULL;
    RETURN QUERY SELECT 'inactive'::text, t.user_id; RETURN;
  END IF;

  INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, family_expires_at, ip, user_agent)
  VALUES (t.user_id, t.family_id, p_new_hash, least(now() + p_ttl, t.family_expires_at),
          t.family_expires_at, p_ip, left(p_ua, 400))
  RETURNING id INTO v_new;

  UPDATE refresh_tokens SET revoked_at = now(), replaced_by = v_new WHERE id = t.id;
  RETURN QUERY SELECT 'ok'::text, t.user_id;
END $$;

CREATE FUNCTION auth_revoke_refresh_token(p_token_hash text) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE refresh_tokens SET revoked_at = now()
  WHERE family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = p_token_hash)
    AND revoked_at IS NULL
  RETURNING user_id
$$;

-- Revoca todas las sesiones de un usuario. Permitido sobre uno mismo o por un
-- administrador de la misma organización.
CREATE FUNCTION auth_revoke_user_tokens(p_user_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_count integer;
BEGIN
  IF app_current_user_id() IS NULL
     OR (p_user_id <> app_current_user_id()
         AND NOT (app_is_admin()
                  AND (SELECT organization_id FROM users WHERE id = p_user_id) = app_current_org_id())) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = p_user_id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION
  auth_find_user_for_login(text), auth_session_user(uuid), auth_mark_login(uuid),
  auth_throttle_check(text, text), auth_throttle_fail(text, text, integer, integer, interval, interval),
  auth_throttle_success(text), auth_issue_refresh_token(uuid, text, interval, interval, text, text),
  auth_rotate_refresh_token(text, text, interval, text, text), auth_revoke_refresh_token(text),
  auth_revoke_user_tokens(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  auth_find_user_for_login(text), auth_session_user(uuid), auth_mark_login(uuid),
  auth_throttle_check(text, text), auth_throttle_fail(text, text, integer, integer, interval, interval),
  auth_throttle_success(text), auth_issue_refresh_token(uuid, text, interval, interval, text, text),
  auth_rotate_refresh_token(text, text, interval, text, text), auth_revoke_refresh_token(text),
  auth_revoke_user_tokens(uuid)
TO crm_app;
