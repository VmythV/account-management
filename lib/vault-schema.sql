CREATE TABLE account_secrets (
  account TEXT PRIMARY KEY REFERENCES accounts(id),
  ciphertext TEXT NOT NULL
) STRICT;
CREATE TABLE vault_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  keyCheck TEXT,
  totpSecret TEXT,
  lastStep INTEGER NOT NULL DEFAULT -1,
  failures INTEGER NOT NULL DEFAULT 0,
  lockedUntil INTEGER NOT NULL DEFAULT 0,
  generation INTEGER NOT NULL DEFAULT 0
) STRICT;
INSERT INTO vault_settings(id) VALUES(1);
