import { getMigrations } from "better-auth/db/migration";
import { auth, database } from "../lib/auth.mjs";
const migration = await getMigrations(auth.options);
await migration.runMigrations();
const workspaceSchema = `
 CREATE TABLE IF NOT EXISTS account_recovery(user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE, key_hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS recovery_limits(identity TEXT PRIMARY KEY, attempts INTEGER NOT NULL, started_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS product_workspaces(user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE, state TEXT NOT NULL, updated_at INTEGER NOT NULL);
`;
if (process.env.TURSO_DATABASE_URL)
  await database.executeMultiple(workspaceSchema);
else database.exec(workspaceSchema);
console.log("Account, session, recovery and workspace tables are ready.");
