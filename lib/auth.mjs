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
  emailAndPassword: {
    enabled: false,
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
  // Preserve stored email accounts without implicitly linking them to wallets.
  if (!wallet || accountMode(session.user) !== "individual") return null;
  return {
    ...session,
    user: { ...session.user, walletAddress: wallet.address },
  };
}
export function accountMode(user) {
  return user?.accountType === "institution" ? "institution" : "individual";
}
