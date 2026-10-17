import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { statementsOf } from '../src/lib/migrate';

const DIR = join(__dirname, '../prisma/migrations');
const NEW = '20261016000000_email_login_approval';
const apply = (db: DatabaseSync, name: string) => statementsOf(join(DIR, name, 'migration.sql')).forEach((sql) => db.exec(sql));

describe('upgrading from authenticator two-factor to email approval', () => {
  const upgraded = () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    const before = readdirSync(DIR).filter((n) => n < NEW).sort();
    before.forEach((name) => apply(db, name));
    const insert = db.prepare(`INSERT INTO "User" ("id","email","name","passwordHash","role","twoFactorEnabled","twoFactorSecret","twoFactorRecovery","updatedAt") VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`);
    insert.run('u1', 'manager@shop.test', 'Manager', 'hash', 'MANAGER', 1, 'sealed-secret', 'hashes');
    insert.run('u2', 'cashier@shop.test', 'Cashier', 'hash', 'CASHIER', 0, null, null);
    apply(db, NEW);
    return db;
  };

  it('keeps everyone who had two-factor on protected (opted in) and removes every authenticator column', () => {
    const db = upgraded();
    const users = db.prepare(`SELECT "id","emailApprovalEnabled" FROM "User" ORDER BY "id"`).all();
    expect(users).toEqual([{ id: 'u1', emailApprovalEnabled: 1 }, { id: 'u2', emailApprovalEnabled: 0 }]);
    const columns = db.prepare(`PRAGMA table_info("User")`).all().map((c) => String(c.name));
    expect(columns.filter((c) => /twoFactor/i.test(c))).toEqual([]);
    expect(columns).toContain('emailApprovalEnabled');
  });

  it('creates LoginApproval with a foreign key to User, a fixed set of statuses and unique token hashes', () => {
    const db = upgraded();
    const row = (id: string, status: string, hashes: [string, string, string]) =>
      db.prepare(`INSERT INTO "LoginApproval" ("id","userId","sentTo","approveTokenHash","rejectTokenHash","pollTokenHash","status","expiresAt","tokenVersion") VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,0)`).run(id, 'u1', 'manager@shop.test', ...hashes, status);
    row('a1', 'PENDING', ['a', 'b', 'c']);
    for (const status of ['APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'COMPLETED', 'FAILED']) row(`s-${status}`, status, [`a-${status}`, `b-${status}`, `c-${status}`]);
    expect(() => row('bad', 'MAYBE', ['x', 'y', 'z'])).toThrow(/CHECK/i);
    expect(() => row('dup', 'PENDING', ['a', 'q', 'r'])).toThrow(/UNIQUE/i);
    expect(() => db.prepare(`INSERT INTO "LoginApproval" ("id","userId","sentTo","approveTokenHash","rejectTokenHash","pollTokenHash","expiresAt","tokenVersion") VALUES ('orphan','nobody','x','1','2','3',CURRENT_TIMESTAMP,0)`).run()).toThrow(/FOREIGN KEY/i);
    db.exec(`DELETE FROM "User" WHERE "id" = 'u1'`);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM "LoginApproval"`).get()).toEqual({ n: 0 });
  });
});
