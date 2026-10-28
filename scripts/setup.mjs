import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (existsSync('.env')) {
  console.log('Your existing .env was preserved.');
} else {
  writeFileSync(
    '.env',
    `HOST_PASSWORD=${randomBytes(18).toString('base64url')}\nPORT=3000\nDATABASE_PATH=./data/party.sqlite\nGAME_CONFIG_PATH=./config/game.yaml\nNODE_ENV=development\nENABLE_REHEARSAL=true\n`,
    { mode: 0o600 },
  );
  console.log('Created private .env. Open it to find HOST_PASSWORD, then run npm run dev.');
}
