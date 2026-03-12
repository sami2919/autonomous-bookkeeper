// Generates dynamic prompt content from the database.

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { chartOfAccounts } from '@/db/schema';
import type * as schema from '@/db/schema';

type DB = BetterSQLite3Database<typeof schema>;

interface COARow {
  code: string;
  name: string;
  type: string;
}

// TODO: add retry logic for transient API failures
export function generateCOATable(db: DB): string {
  const rows: COARow[] = db
    .select({
      code: chartOfAccounts.code,
      name: chartOfAccounts.name,
      type: chartOfAccounts.type,
    })
    .from(chartOfAccounts)
    .orderBy(chartOfAccounts.code)
    .all();

  if (rows.length === 0) {
    return '| Code | Name | Type |\n|------|------|------|\n| (no accounts found) | | |';
  }

  const capitalize = (s: string): string =>
    s.charAt(0).toUpperCase() + s.slice(1);

  const header = '| Code | Name                                   | Type    |';
  const separator = '|------|----------------------------------------|---------|';
  const dataRows = rows.map((row) => {
    const name = row.name.padEnd(38);
    const type = capitalize(row.type).padEnd(7);
    return `| ${row.code} | ${name} | ${type} |`;
  });

  return [header, separator, ...dataRows].join('\n');
}

export function getAccountNamesMap(db: DB): Record<string, string> {
  const rows: COARow[] = db
    .select({
      code: chartOfAccounts.code,
      name: chartOfAccounts.name,
      type: chartOfAccounts.type,
    })
    .from(chartOfAccounts)
    .orderBy(chartOfAccounts.code)
    .all();

  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.code] = row.name;
  }
  return map;
}
