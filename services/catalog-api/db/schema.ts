import { sqliteTable, text, index, primaryKey } from "drizzle-orm/sqlite-core";

// Schema migrations contain no source data. Revisions and observations are append-only.
export const sourceSnapshots = sqliteTable("source_snapshots", {
  snapshotId: text("snapshot_id").primaryKey(),
  manifestJson: text("manifest_json").notNull(),
});
export const catalogEntities = sqliteTable("catalog_entities", {
  entityKey: text("entity_key").primaryKey(),
  kind: text("kind", { enum: ["card", "pack"] }).notNull(),
  sourceId: text("source_id").notNull(),
  currentRevisionId: text("current_revision_id").notNull(),
}, (t) => [index("catalog_kind_key_idx").on(t.kind, t.entityKey)]);
export const entityRevisions = sqliteTable("entity_revisions", {
  revisionId: text("revision_id").primaryKey(),
  entityKey: text("entity_key").notNull(),
  payloadJson: text("payload_json").notNull(),
  snapshotId: text("snapshot_id").notNull(),
}, (t) => [index("revisions_entity_idx").on(t.entityKey)]);
export const packMemberships = sqliteTable("pack_memberships", {
  packKey: text("pack_key").notNull(),
  cardKey: text("card_key").notNull(),
  evidenceJson: text("evidence_json").notNull(),
  snapshotId: text("snapshot_id").notNull(),
}, (t) => [primaryKey({ columns: [t.packKey, t.cardKey, t.snapshotId] }), index("memberships_card_idx").on(t.cardKey)]);
export const quarantine = sqliteTable("quarantine", {
  quarantineId: text("quarantine_id").primaryKey(),
  snapshotId: text("snapshot_id").notNull(),
  reason: text("reason").notNull(),
  payloadJson: text("payload_json").notNull(),
});
