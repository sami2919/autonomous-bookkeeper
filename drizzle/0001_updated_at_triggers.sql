-- Auto-update updated_at on row changes.
-- SQLite has no ON UPDATE column default, so triggers are required.
CREATE TRIGGER update_transactions_updated_at
AFTER UPDATE ON transactions
BEGIN
  UPDATE transactions SET updated_at = datetime('now') WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER update_journal_entries_updated_at
AFTER UPDATE ON journal_entries
BEGIN
  UPDATE journal_entries SET updated_at = datetime('now') WHERE id = NEW.id;
END;
