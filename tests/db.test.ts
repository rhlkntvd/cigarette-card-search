import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

const originalDatabaseUrl = process.env.DATABASE_URL;
delete process.env.DATABASE_URL;

// Import without configuration to catch a return to eager initialization.
const { getSql, closeDatabase } = await import("../src/db.js");

const testDatabaseUrl = "postgres://cards:localdev@127.0.0.1:1/cigarette_cards";

beforeEach(() => {
  delete process.env.DATABASE_URL;
});

afterEach(async () => {
  await closeDatabase();

  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

test("requires DATABASE_URL only when requesting a client", () => {
  assert.throws(getSql, /DATABASE_URL is not set/);
});

test("shutdown before initialization does not require configuration", async () => {
  await closeDatabase();
});

test("reuses the client and closes it only once", async (t) => {
  process.env.DATABASE_URL = testDatabaseUrl;

  // Creating a Postgres.js client does not connect until a query is executed.
  const client = getSql();
  assert.equal(getSql(), client);

  const endMock = t.mock.method(client, "end");
  await closeDatabase();
  await closeDatabase();

  assert.equal(endMock.mock.callCount(), 1);

  delete process.env.DATABASE_URL;
  assert.throws(getSql, /DATABASE_URL is not set/);
});

test("can initialize a new client after shutdown", async () => {
  process.env.DATABASE_URL = testDatabaseUrl;
  const firstClient = getSql();

  await closeDatabase();

  const secondClient = getSql();
  assert.notEqual(secondClient, firstClient);
});
