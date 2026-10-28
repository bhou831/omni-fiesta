import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const [sourceArg, destinationArg] = process.argv.slice(2);
if (!sourceArg || !destinationArg)
  throw new Error('Usage: node scripts/backup.mjs SOURCE.sqlite BACKUP.sqlite');
const source = resolve(sourceArg);
const destination = resolve(destinationArg);
if (!existsSync(source)) throw new Error('Source database does not exist');
if (existsSync(destination)) throw new Error('Backup destination already exists');
const database = new DatabaseSync(source, { readOnly: true });
try {
  database.prepare('VACUUM INTO ?').run(destination);
} finally {
  database.close();
}
console.log(`Consistent SQLite backup written to ${destination}`);
