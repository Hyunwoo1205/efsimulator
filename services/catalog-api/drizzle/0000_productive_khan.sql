CREATE TABLE `catalog_entities` (
	`entity_key` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`source_id` text NOT NULL,
	`current_revision_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `catalog_kind_key_idx` ON `catalog_entities` (`kind`,`entity_key`);--> statement-breakpoint
CREATE TABLE `entity_revisions` (
	`revision_id` text PRIMARY KEY NOT NULL,
	`entity_key` text NOT NULL,
	`payload_json` text NOT NULL,
	`snapshot_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `revisions_entity_idx` ON `entity_revisions` (`entity_key`);--> statement-breakpoint
CREATE TABLE `pack_memberships` (
	`pack_key` text NOT NULL,
	`card_key` text NOT NULL,
	`evidence_json` text NOT NULL,
	`snapshot_id` text NOT NULL,
	PRIMARY KEY(`pack_key`, `card_key`, `snapshot_id`)
);
--> statement-breakpoint
CREATE INDEX `memberships_card_idx` ON `pack_memberships` (`card_key`);--> statement-breakpoint
CREATE TABLE `quarantine` (
	`quarantine_id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`reason` text NOT NULL,
	`payload_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_snapshots` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`manifest_json` text NOT NULL
);
