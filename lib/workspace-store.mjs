import { database } from "./auth.mjs";
import { createWorkspace } from "./product-ledger.mjs";
const select = "SELECT state FROM product_workspaces WHERE user_id=?";
const upsert =
  "INSERT INTO product_workspaces(user_id,state,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at";
function restore(row) {
  const state = row ? JSON.parse(row.state) : createWorkspace(Date.now(), true);
  state.replays = new Map(row ? state.replays : []);
  return state;
}
const encode = (state) =>
  JSON.stringify({ ...state, replays: [...state.replays] });
export async function withWorkspace(userId, update) {
  if (!process.env.TURSO_DATABASE_URL)
    return database.transaction(() => {
      const state = restore(database.prepare(select).get(userId));
      const result = update(state);
      database.prepare(upsert).run(userId, encode(state), Date.now());
      return result;
    })();
  const tx = await database.transaction("write");
  try {
    const row = (await tx.execute({ sql: select, args: [userId] })).rows[0];
    const state = restore(row),
      result = update(state);
    await tx.execute({
      sql: upsert,
      args: [userId, encode(state), Date.now()],
    });
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}
