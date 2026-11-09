CREATE TABLE passkey_credentials (
  id INTEGER PRIMARY KEY CHECK(id=1),
  credentialId TEXT NOT NULL UNIQUE,
  publicKey BLOB NOT NULL,
  userId BLOB NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT NOT NULL,
  createdAt TEXT NOT NULL
) STRICT;
