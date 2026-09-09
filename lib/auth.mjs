import { betterAuth } from "better-auth";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const databasePath =
  process.env.THESAUROS_AUTH_DB ||
  resolve(process.cwd(), "../private-state/accounts.sqlite");
mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
export const database = (globalThis.__thesaurosAuthDb ??= new Database(
  databasePath,
));
database.pragma("journal_mode = WAL");
database.pragma("foreign_keys = ON");
database.pragma("busy_timeout = 5000");
export const auth = betterAuth({
  appName: "Thesauros",
  database,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL || "http://80.241.220.22:8878",
  basePath: (process.env.NEXT_PUBLIC_BASE_PATH || "") + "/api/auth",
  trustedOrigins: [
    process.env.BETTER_AUTH_URL || "http://80.241.220.22:8878",
    "http://127.0.0.1:18880",
    "http://localhost:18880",
  ],
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
      "/sign-in/email": { window: 60, max: 8 },
      "/sign-up/email": { window: 60, max: 5 },
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
    cookiePrefix: "thesauros",
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    useSecureCookies: (process.env.BETTER_AUTH_URL || "").startsWith(
      "https://",
    ),
  },
});

export async function userSession(headers) {
  return auth.api.getSession({ headers });
}
export function accountMode(user) {
  return user?.accountType === "institution" ? "institution" : "individual";
}
