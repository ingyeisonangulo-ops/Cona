import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

const { accessSecret, accessTtlSeconds, issuer, audience } = config.jwt;

// El access token solo lleva identidad y versión; rol y estado se leen de la BD
// en cada request para que un cambio de rol surta efecto de inmediato.
export function signAccessToken(user) {
  return jwt.sign({ tv: user.token_version }, accessSecret, {
    algorithm: 'HS256',
    subject: user.id,
    expiresIn: accessTtlSeconds,
    issuer,
    audience,
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, accessSecret, { algorithms: ['HS256'], issuer, audience });
}

export function newOpaqueToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
