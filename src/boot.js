// Punto de entrada: restaura la base de datos del bucket (si hace falta) y arranca el servidor.
import { restoreIfNeeded } from './db-sync.js';

await restoreIfNeeded();
await import('./server.js');
