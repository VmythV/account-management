CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  identifier TEXT NOT NULL,
  type TEXT NOT NULL,
  created TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('正常','已归档')),
  notes TEXT NOT NULL,
  website TEXT NOT NULL DEFAULT '',
  insertedAt TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(name, identifier)
) STRICT;
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE TABLE account_tags (
  account TEXT NOT NULL REFERENCES accounts(id),
  tag TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(account, tag)
) STRICT;
CREATE INDEX account_tags_tag ON account_tags(tag);
CREATE TABLE account_relations (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL REFERENCES accounts(id),
  target TEXT NOT NULL REFERENCES accounts(id),
  type TEXT NOT NULL,
  notes TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  CHECK(source != target),
  UNIQUE(source,target,type)
) STRICT;
CREATE INDEX relations_target ON account_relations(target);
CREATE TABLE account_events (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('账号记录','关联变更','订阅变更')),
  automatic INTEGER NOT NULL DEFAULT 0 CHECK(automatic IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE INDEX account_events_date ON account_events(account,date);
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE INDEX subscriptions_account ON subscriptions(account);
CREATE TABLE subscription_events (
  id TEXT PRIMARY KEY,
  subscription TEXT NOT NULL REFERENCES subscriptions(id),
  occurredAt TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','trial','paused','cancelled','expired','banned')),
  plan TEXT NOT NULL,
  notes TEXT NOT NULL,
  renewalCycle TEXT NOT NULL CHECK(renewalCycle IN ('none','monthly','yearly')),
  renewalDay INTEGER,
  renewalMonth INTEGER,
  UNIQUE(subscription,occurredAt),
  CHECK((renewalCycle='none' AND renewalDay IS NULL AND renewalMonth IS NULL)
    OR (renewalCycle='monthly' AND renewalDay BETWEEN 1 AND 31 AND renewalMonth IS NULL)
    OR (renewalCycle='yearly' AND renewalDay BETWEEN 1 AND 31 AND renewalMonth BETWEEN 1 AND 12))
) STRICT;
