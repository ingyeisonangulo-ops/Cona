import { config } from '../config.js';

const secure = config.cookies.secure;

// Prefijos __Host-/__Secure- exigen Secure; solo se usan cuando está activo.
export const ACCESS_COOKIE = secure ? '__Host-na_at' : 'na_at';
export const REFRESH_COOKIE = secure ? '__Secure-na_rt' : 'na_rt';
const REFRESH_PATH = '/api/auth';

const base = { httpOnly: true, secure, sameSite: 'strict' };

export function setAuthCookies(res, accessToken, refreshToken) {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...base,
    path: '/',
    maxAge: config.jwt.accessTtlSeconds * 1000,
  });
  if (refreshToken) {
    res.cookie(REFRESH_COOKIE, refreshToken, {
      ...base,
      path: REFRESH_PATH,
      maxAge: config.refresh.ttlDays * 86_400_000,
    });
  }
}

export function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_PATH });
}
