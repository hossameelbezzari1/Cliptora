const { createHmac, randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const { mkdirSync, writeFileSync } = require('node:fs');

const requireFromN8n = createRequire('/usr/local/lib/node_modules/n8n/package.json');
const sqlite3 = requireFromN8n('sqlite3');

const databasePath = process.env.N8N_DATABASE_PATH || '/home/node/.n8n/database.sqlite';
const outputPath = process.env.N8N_API_KEY_OUTPUT || '/run/cliptora/n8n_api_key';
const secret = process.env.N8N_USER_MANAGEMENT_JWT_SECRET;
const label = 'CLIPTORA Docker';
const scopes = [
  'workflow:create',
  'workflow:read',
  'workflow:update',
  'workflow:delete',
  'workflow:list',
  'workflow:activate',
  'workflow:deactivate',
];

if (!secret) throw new Error('N8N_USER_MANAGEMENT_JWT_SECRET is required');

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const query = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
});
const run = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, (error) => error ? reject(error) : resolve());
});

async function main() {
  const db = new sqlite3.Database(databasePath);
  try {
    const users = await query(db, 'SELECT id FROM user ORDER BY createdAt ASC LIMIT 1');
    if (!users.length) throw new Error('Finish the n8n owner setup before bootstrapping CLIPTORA');

    const userId = users[0].id;
    const existing = await query(
      db,
      'SELECT apiKey FROM user_api_keys WHERE userId = ? AND label = ? LIMIT 1',
      [userId, label],
    );

    let apiKey = existing[0]?.apiKey;
    if (!apiKey) {
      const now = Math.floor(Date.now() / 1000);
      const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
        sub: userId,
        iss: 'n8n',
        jti: randomUUID(),
        iat: now,
        aud: 'public-api',
      })}`;
      apiKey = `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
      const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
      await run(
        db,
        'INSERT INTO user_api_keys (id, userId, label, scopes, apiKey, audience, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [randomUUID(), userId, label, JSON.stringify(scopes), apiKey, 'public-api', timestamp, timestamp],
      );
    }

    mkdirSync(require('node:path').dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${apiKey}\n`, { mode: 0o600 });
    console.log('CLIPTORA n8n API key is ready.');
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
