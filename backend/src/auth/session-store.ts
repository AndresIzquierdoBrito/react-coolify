import session from "express-session";
import type { DatabaseContext } from "../db/index.js";

export class SQLiteSessionStore extends session.Store {
  constructor(private readonly db: DatabaseContext) {
    super();
  }

  get(sid: string, callback: (err?: unknown, session?: session.SessionData | null) => void) {
    try {
      const row = this.db.sqlite.prepare(`SELECT sess,expires_at FROM sessions WHERE sid=?`).get(sid) as { sess: string; expires_at: number } | undefined;
      if (!row || row.expires_at <= Date.now()) {
        if (row) this.db.sqlite.prepare(`DELETE FROM sessions WHERE sid=?`).run(sid);
        callback(undefined, null);
        return;
      }
      callback(undefined, JSON.parse(row.sess) as session.SessionData);
    } catch (error) { callback(error); }
  }

  set(sid: string, value: session.SessionData, callback?: (err?: unknown) => void) {
    try {
      const expiresAt = value.cookie.expires?.getTime() ?? Date.now() + (value.cookie.maxAge ?? 86_400_000);
      this.db.sqlite.prepare(`INSERT INTO sessions(sid,sess,expires_at) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess,expires_at=excluded.expires_at`).run(sid, JSON.stringify(value), expiresAt);
      callback?.();
    } catch (error) { callback?.(error); }
  }

  destroy(sid: string, callback?: (err?: unknown) => void) {
    try { this.db.sqlite.prepare(`DELETE FROM sessions WHERE sid=?`).run(sid); callback?.(); }
    catch (error) { callback?.(error); }
  }

  touch(sid: string, value: session.SessionData, callback?: () => void) { this.set(sid, value, callback); }
}
