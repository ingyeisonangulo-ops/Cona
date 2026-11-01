import { sslOption } from '../src/lib/pgSsl.js';

export const pgSslFromEnv = () => sslOption(process.env.DB_SSL ?? 'verify-full');
