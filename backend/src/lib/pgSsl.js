// Traduce DB_SSL a la opción `ssl` de node-postgres.
export function sslOption(mode) {
  switch (mode) {
    case 'disable':
      return false;
    case 'require':
      // Cifra el canal sin verificar el certificado (proxy público de Railway).
      return { rejectUnauthorized: false };
    default:
      return { rejectUnauthorized: true };
  }
}
