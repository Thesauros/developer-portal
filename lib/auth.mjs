import { betterAuth } from "better-auth";
import { siwe } from "better-auth/plugins/siwe";
import { createClient } from "@libsql/client";
import { LibsqlDialect } from "@libsql/kysely-libsql";
import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { verifyWalletMessage } from "./wallet-auth.mjs";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Use Turso if TURSO_DATABASE_URL is set, otherwise fall back to local SQLite
let database;
if (process.env.TURSO_DATABASE_URL) {
  database = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
} else {
  const databasePath =
    process.env.THESAUROS_AUTH_DB ||
    resolve(process.cwd(), "../private-state/accounts.sqlite");
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  database = globalThis.__thesaurosAuthDb ??= new Database(databasePath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
}

export { database };
export const authOrigin = new URL(
  process.env.BETTER_AUTH_URL || "http://80.241.220.22:8878",
).origin;
export const auth = betterAuth({
  appName: "Thesauros",
  database: process.env.TURSO_DATABASE_URL
    ? {
        dialect: new LibsqlDialect({ client: database }),
        type: "sqlite",
        transaction: true,
      }
    : database,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL || "http://80.241.220.22:8878",
  basePath: "/api/auth",
  trustedOrigins: [
    process.env.BETTER_AUTH_URL || "http://80.241.220.22:8878",
    "http://127.0.0.1:18880",
    "http://localhost:18880",
  ],
  // Email and password is for Institution accounts; Individuals use wallets.
  // The auth route rejects email sign-up for any other account type.
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    autoSignIn: true,
    revokeSessionsOnPasswordReset: true,
  },
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/siwe/nonce": { window: 60, max: 12 },
      "/siwe/get-nonce": { window: 60, max: 12 },
      "/siwe/verify": { window: 60, max: 8 },
      "/sign-in/email": { window: 60, max: 8 },
      "/sign-up/email": { window: 60, max: 5 },
      "/change-password": { window: 60, max: 8 },
    },
  },
  user: {
    additionalFields: {
      accountType: {
        type: "string",
        required: false,
        defaultValue: "individual",
        input: false,
      },
      company: {
        type: "string",
        required: false,
        defaultValue: "",
        input: false,
      },
    },
  },
  advanced: {
    ipAddress: { ipAddressHeaders: ["x-real-ip"] },
    cookiePrefix: "thesauros",
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    useSecureCookies: (process.env.BETTER_AUTH_URL || "").startsWith(
      "https://",
    ),
  },
  plugins: [
    siwe({
      domain: new URL(authOrigin).host,
      anonymous: true,
      getNonce: async () => randomBytes(24).toString("hex"),
      verifyMessage: (request) => verifyWalletMessage(request, authOrigin),
    }),
  ],
});

export async function userSession(headers) {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const context = await auth.$context;
  const wallet = await context.adapter.findOne({
    model: "walletAddress",
    where: [
      { field: "userId", value: session.user.id },
      { field: "isPrimary", value: true },
    ],
  });
  // The Individual workspace needs a signed-in wallet; the account type only
  // selects which workspace a user lands in.
  if (!wallet) return null;
  return {
    ...session,
    user: { ...session.user, walletAddress: wallet.address },
  };
}
// Institution accounts sign in with email; their workspace reads the treasury
// wallet they link in Account settings (watch-only until they connect it).
export async function institutionSession(headers) {
  const session = await auth.api.getSession({ headers });
  if (!session || accountMode(session.user) !== "institution") return null;
  const [treasury] = await dbAll(
    "SELECT address FROM treasury_wallets WHERE user_id=?",
    [session.user.id],
  );
  const [wallet] = await dbAll(
    "SELECT address FROM walletAddress WHERE userId=? AND isPrimary=1",
    [session.user.id],
  );
  const [credential] = await dbAll(
    "SELECT id FROM account WHERE userId=? AND providerId='credential'",
    [session.user.id],
  );
  const [flags] = await dbAll(
    "SELECT email_prompt_dismissed FROM profile_flags WHERE user_id=?",
    [session.user.id],
  );
  const hasEmail = !isPlaceholderEmail(session.user.email);
  return {
    ...session,
    user: {
      ...session.user,
      email: hasEmail ? session.user.email : null,
      // Positions come from the linked treasury wallet, else the sign-in wallet.
      walletAddress: treasury?.address || wallet?.address || null,
      signInWallet: wallet?.address || null,
      treasuryWallet: treasury?.address || null,
      hasPassword: !!credential,
      askForEmail: !hasEmail && !flags?.email_prompt_dismissed,
    },
  };
}
// Wallet sign-in creates users with a generated address.
export const isPlaceholderEmail = (email) =>
  !email || /@siwe\.placeholder\.invalid$/i.test(email);
export async function workspaceSession(headers) {
  return (await userSession(headers)) || (await institutionSession(headers));
}

// Small query helpers over either local SQLite or Turso.
export async function dbAll(sql, args = []) {
  if (process.env.TURSO_DATABASE_URL)
    return (await database.execute({ sql, args })).rows;
  return database.prepare(sql).all(...args);
}
export async function dbRun(sql, args = []) {
  if (process.env.TURSO_DATABASE_URL) return database.execute({ sql, args });
  return database.prepare(sql).run(...args);
}
export const treasurySchema =
  "CREATE TABLE IF NOT EXISTS treasury_wallets(user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE, address TEXT NOT NULL, updated_at INTEGER NOT NULL)";
export const profileSchema =
  "CREATE TABLE IF NOT EXISTS profile_flags(user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE, email_prompt_dismissed INTEGER NOT NULL DEFAULT 0)";
if (!process.env.TURSO_DATABASE_URL) {
  database.exec(treasurySchema);
  database.exec(profileSchema);
}

export function accountMode(user) {
  return user?.accountType === "institution" ? "institution" : "individual";
}
