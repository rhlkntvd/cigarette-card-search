import postgres from "postgres";

let sql: postgres.Sql | undefined;

export function getSql(): postgres.Sql {
  if (sql) {
    return sql;
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  sql = postgres(databaseUrl);
  return sql;
}

export async function closeDatabase(): Promise<void> {
  const client = sql;
  sql = undefined;
  await client?.end();
}
