import Database from "better-sqlite3";
import { parseGroceryText } from "../parser/groceryParser.js";
import { schemaSql } from "./schema.js";

export type ReminderInput = {
  externalId: string;
  listId: string;
  listName?: string | null;
  title: string;
  notes: string | null;
  completed: boolean;
};

export type ProductCandidateInput = {
  catalogItemId?: number | null;
  walmartProductId?: string | null;
  title: string;
  url: string;
  priceText: string | null;
  sizeText: string | null;
  availabilityText: string | null;
  imageUrl: string | null;
  confidence: number;
  source: string;
};

export type ListItemsOptions = {
  includeInactive?: boolean;
};

export type DashboardDeletion = {
  externalId: string;
  action: "complete" | "delete";
};

export type AppDatabase = {
  raw: Database.Database;
  upsertReminder(input: ReminderInput): void;
  listReminders(): Record<string, unknown>[];
  listItems(options?: ListItemsOptions): Record<string, unknown>[];
  listApprovals(): Record<string, unknown>[];
  listHistory(): Record<string, unknown>[];
  replaceCandidates(itemId: number, candidates: ProductCandidateInput[]): void;
  approveItem(input: {
    itemId: number;
    candidateId?: number | null;
    walmartProductId?: string | null;
    url: string;
    title: string;
    imageUrl?: string | null;
    chosenBy: string;
  }): void;
  getChosenProduct(itemId: number): Record<string, unknown> | null;
  getTrustedMapping(phrase: string): Record<string, unknown> | null;
  countsByStatus(): Record<string, number>;
  markItemAdding(itemId: number): void;
  markItemAdded(itemId: number, message: string): void;
  markItemManualAction(itemId: number, message: string): void;
  markItemFailed(itemId: number, message: string): void;
  markItemOrdered(itemId: number, message: string): void;
  fulfillItem(itemId: number, source: string): DashboardDeletion | null;
  deleteItem(itemId: number, source: string): DashboardDeletion;
  resetItemForRetry(itemId: number): void;
  updateWalmartSession(status: string, message: string | null, needsManualAction: boolean): void;
  setSyncState(key: string, status: string, errorMessage?: string | null): void;
  listSyncState(): Record<string, unknown>[];
  rejectItem(itemId: number): void;
};

export function createDatabase(path: string): AppDatabase {
  const raw = new Database(path);
  raw.pragma("journal_mode = WAL");
  raw.exec(schemaSql);
  migrateExistingDatabase(raw);

	  return {
	    raw,
	    upsertReminder(input) {
	      const now = new Date().toISOString();
	      const completedAt = input.completed ? now : null;
	      raw.prepare(
	        `
	        insert into reminders (
	          external_id, list_id, list_name, title, notes, completed, completed_at,
	          deleted_at, first_seen_at, last_seen_at
	        )
	        values (
	          @externalId, @listId, @listName, @title, @notes, @completed, @completedAt,
	          null, @now, @now
	        )
	        on conflict(external_id) do update set
	          list_id = excluded.list_id,
	          list_name = excluded.list_name,
	          title = excluded.title,
	          notes = excluded.notes,
	          completed = excluded.completed,
	          completed_at = case when excluded.completed = 1 then coalesce(reminders.completed_at, excluded.completed_at) else null end,
	          deleted_at = case when excluded.completed = 1 then coalesce(reminders.deleted_at, excluded.completed_at) else null end,
	          last_seen_at = excluded.last_seen_at
	      `
	      ).run({ ...input, listName: input.listName ?? null, completed: input.completed ? 1 : 0, completedAt, now });

	      const reminder = raw.prepare("select id, completed, deleted_at from reminders where external_id = ?").get(input.externalId) as
	        | { id: number; completed: number; deleted_at: string | null }
	        | undefined;
	      if (!reminder) return;

	      if (input.completed) {
	        raw.prepare(
	          `
	          update grocery_items
	          set status = case when status = 'fulfilled' then status else 'deleted' end,
	              deleted_at = coalesce(deleted_at, ?),
	              updated_at = ?
	          where reminder_id = ? and status not in ('fulfilled', 'deleted')
	        `
	        ).run(now, now, reminder.id);
	        return;
	      }

	      const existing = raw
	        .prepare("select id, status from grocery_items where reminder_id = ? order by id desc limit 1")
	        .get(reminder.id) as { id: number; status: string } | undefined;
	      if (
	        existing &&
	        ["auto_matched", "approved", "adding", "added_to_cart", "manual_action", "ordered", "fulfilled", "skipped"].includes(
	          existing.status
	        )
	      ) {
	        return;
	      }

	      const parsed = parseGroceryText(input.title);
	      if (existing) {
	        raw.prepare(
          `
          update grocery_items set
            raw_text = @rawText,
            normalized_text = @normalizedText,
            quantity_value = @quantityValue,
	            quantity_unit = @quantityUnit,
	            brand_hint = @brandHint,
	            product_terms = @productTerms,
	            status = 'parsed',
	            cart_status = 'not_added',
	            error_message = null,
	            deleted_at = null,
	            updated_at = @now
	          where id = @id
	        `
        ).run({ ...parsed, id: existing.id, now });
      } else {
        raw.prepare(
	          `
	          insert into grocery_items (
	            reminder_id, raw_text, normalized_text, quantity_value, quantity_unit,
	            brand_hint, product_terms, status, cart_status, created_at, updated_at
	          )
	          values (
	            @reminderId, @rawText, @normalizedText, @quantityValue, @quantityUnit,
	            @brandHint, @productTerms, 'parsed', 'not_added', @now, @now
	          )
	        `
        ).run({ ...parsed, reminderId: reminder.id, now });
      }
    },
	    listReminders() {
	      return raw.prepare("select * from reminders order by id").all() as Record<string, unknown>[];
	    },
	    listItems(options = {}) {
	      return listItemsQuery(raw, options.includeInactive ?? false, null);
	    },
	    listApprovals() {
	      return listItemsQuery(raw, false, ["needs_review", "parsed", "failed", "manual_action"]);
	    },
	    listHistory() {
	      return listItemsQuery(raw, true, null, 80);
	    },
    replaceCandidates(itemId, candidates) {
      const now = new Date().toISOString();
      const tx = raw.transaction(() => {
        raw.prepare("delete from product_candidates where grocery_item_id = ?").run(itemId);
        for (const candidate of candidates) {
          raw.prepare(
            `
	            insert into product_candidates (
	              grocery_item_id, catalog_item_id, walmart_product_id, title, url, price_text,
	              size_text, availability_text, image_url, confidence, source, captured_at
	            )
	            values (
	              @itemId, @catalogItemId, @walmartProductId, @title, @url, @priceText,
	              @sizeText, @availabilityText, @imageUrl, @confidence, @source, @now
	            )
	          `
	          ).run({
	            ...candidate,
	            catalogItemId: candidate.catalogItemId ?? null,
	            walmartProductId: candidate.walmartProductId ?? null,
	            itemId,
	            now
	          });
	        }
	        raw.prepare("update grocery_items set status = 'needs_review', error_message = null, updated_at = ? where id = ?").run(
	          now,
	          itemId
	        );
	      });
	      tx();
	    },
	    approveItem(input) {
	      const now = new Date().toISOString();
	      const item = raw
	        .prepare("select raw_text, normalized_text from grocery_items where id = ?")
	        .get(input.itemId) as { raw_text: string; normalized_text: string } | undefined;
	      if (!item) throw new Error("No approvable grocery item found.");
	      const result = raw
	        .prepare(
	          `
	          update grocery_items
	          set status = 'approved', approved_at = ?, error_message = null, updated_at = ?
	          where id = ? and status not in ('added_to_cart', 'ordered', 'fulfilled', 'deleted')
	        `
	        )
        .run(now, now, input.itemId);
	      if (result.changes === 0) throw new Error("No approvable grocery item found.");
	      raw.prepare(
	        `
	        insert into chosen_products (
	          grocery_item_id, candidate_id, walmart_product_id, url, title, image_url, chosen_by, chosen_at
	        )
	        values (
	          @itemId, @candidateId, @walmartProductId, @url, @title, @imageUrl, @chosenBy, @now
	        )
	        on conflict(grocery_item_id) do update set
	          candidate_id = excluded.candidate_id,
	          walmart_product_id = excluded.walmart_product_id,
	          url = excluded.url,
	          title = excluded.title,
	          image_url = excluded.image_url,
	          chosen_by = excluded.chosen_by,
	          chosen_at = excluded.chosen_at
	      `
	      ).run({
	        candidateId: input.candidateId ?? null,
	        walmartProductId: input.walmartProductId ?? null,
	        imageUrl: input.imageUrl ?? null,
	        ...input,
	        now
	      });
	      raw.prepare(
	        `
	        insert into phrase_mappings (
	          phrase, walmart_product_id, url, title, trusted, created_at, updated_at
	        )
	        values (@phrase, @walmartProductId, @url, @title, 1, @now, @now)
	        on conflict(phrase) do update set
	          walmart_product_id = excluded.walmart_product_id,
	          url = excluded.url,
	          title = excluded.title,
	          trusted = 1,
	          updated_at = excluded.updated_at
	      `
	      ).run({
	        phrase: item.normalized_text,
	        walmartProductId: input.walmartProductId ?? null,
	        url: input.url,
	        title: input.title,
	        now
	      });
	    },
    getChosenProduct(itemId) {
      return (
        (raw
          .prepare(
            `
	            select cp.*, gi.raw_text, gi.quantity_value, gi.quantity_unit
	            from chosen_products cp
	            join grocery_items gi on gi.id = cp.grocery_item_id
	            where cp.grocery_item_id = ?
          `
	          )
	          .get(itemId) as Record<string, unknown> | undefined) ?? null
	      );
	    },
	    getTrustedMapping(phrase) {
	      return (
	        (raw.prepare("select * from phrase_mappings where phrase = ? and trusted = 1").get(phrase) as
	          | Record<string, unknown>
	          | undefined) ?? null
	      );
	    },
	    countsByStatus() {
	      const rows = raw
	        .prepare(
	          `
	          select status, count(*) as count
	          from grocery_items
	          where deleted_at is null and status not in ('deleted', 'fulfilled')
	          group by status
	        `
	        )
	        .all() as { status: string; count: number }[];
	      const counts: Record<string, number> = {
	        parsed: 0,
	        matching: 0,
	        auto_matched: 0,
	        needs_review: 0,
	        approved: 0,
	        adding: 0,
	        added_to_cart: 0,
	        manual_action: 0,
	        ordered: 0,
	        fulfilled: 0,
	        skipped: 0,
	        deleted: 0,
	        failed: 0
	      };
	      for (const row of rows) counts[row.status] = row.count;
	      return counts;
	    },
	    markItemAdding(itemId) {
	      const now = new Date().toISOString();
	      raw.prepare(
	        "update grocery_items set status = 'adding', cart_status = 'adding', error_message = null, updated_at = ? where id = ?"
	      ).run(now, itemId);
	      raw.prepare(
	        "insert into automation_runs (grocery_item_id, action, status, started_at) values (?, 'add_to_cart', 'running', ?)"
	      ).run(itemId, now);
	    },
	    markItemAdded(itemId, message) {
	      const now = new Date().toISOString();
	      raw.prepare(
	        `
	        update grocery_items
	        set status = 'added_to_cart', cart_status = 'added', error_message = ?, added_at = ?, updated_at = ?
	        where id = ?
	      `
	      ).run(message, now, now, itemId);
	      raw.prepare("insert into cart_events (grocery_item_id, action, status, message, created_at) values (?, 'add_to_cart', 'added', ?, ?)").run(
	        itemId,
	        message,
	        now
	      );
	      raw.prepare(
	        `
	        update automation_runs
	        set status = 'added', finished_at = ?, error_message = ?
	        where id = (select id from automation_runs where grocery_item_id = ? order by id desc limit 1)
	      `
	      ).run(now, message, itemId);
	    },
	    markItemManualAction(itemId, message) {
	      const now = new Date().toISOString();
	      raw.prepare(
	        `
	        update grocery_items
	        set status = 'manual_action', cart_status = 'manual_action', error_message = ?, updated_at = ?
	        where id = ?
	      `
	      ).run(message, now, itemId);
	      raw.prepare(
	        "insert into automation_runs (grocery_item_id, action, status, started_at, finished_at, error_message) values (?, 'add_to_cart', 'manual_action', ?, ?, ?)"
	      ).run(itemId, now, now, message);
	    },
	    markItemFailed(itemId, message) {
	      const now = new Date().toISOString();
	      raw.prepare(
	        "update grocery_items set status = 'failed', cart_status = 'not_added', error_message = ?, updated_at = ? where id = ?"
	      ).run(message, now, itemId);
      raw.prepare(
        `
        update automation_runs
        set status = 'failed', finished_at = ?, error_message = ?
        where id = (select id from automation_runs where grocery_item_id = ? order by id desc limit 1)
      `
	      ).run(now, message, itemId);
	    },
	    markItemOrdered(itemId, message) {
	      const now = new Date().toISOString();
	      raw.prepare(
	        `
	        update grocery_items
	        set status = 'ordered', cart_status = 'ordered', error_message = ?, ordered_at = ?, updated_at = ?
	        where id = ?
	      `
	      ).run(message, now, now, itemId);
	    },
	    fulfillItem(itemId, source) {
	      const now = new Date().toISOString();
	      const deletion = reminderDeletionForItem(raw, itemId);
	      const result = raw.prepare(
	        `
	        update grocery_items
	        set status = 'fulfilled', cart_status = 'ordered', fulfilled_at = ?, updated_at = ?
	        where id = ? and status != 'deleted'
	      `
	      ).run(now, now, itemId);
	      if (result.changes === 0) return null;
	      raw.prepare(
	        `
	        update reminders
	        set completed = 1, completed_at = coalesce(completed_at, ?), deleted_at = coalesce(deleted_at, ?)
	        where id = (select reminder_id from grocery_items where id = ?)
	      `
	      ).run(now, now, itemId);
	      raw.prepare(
	        "insert into automation_runs (grocery_item_id, action, status, started_at, finished_at, error_message) values (?, 'fulfill_reminder', ?, ?, ?, null)"
	      ).run(itemId, source, now, now);
	      return deletion;
	    },
	    deleteItem(itemId) {
	      const now = new Date().toISOString();
	      const deletion = reminderDeletionForItem(raw, itemId);
	      if (!deletion) throw new Error("Item not found.");
	      raw.prepare(
	        `
	        update grocery_items
	        set status = 'deleted', deleted_at = coalesce(deleted_at, ?), updated_at = ?
	        where id = ?
	      `
	      ).run(now, now, itemId);
	      raw.prepare(
	        `
	        update reminders
	        set completed = 1, completed_at = coalesce(completed_at, ?), deleted_at = coalesce(deleted_at, ?)
	        where external_id = ?
	      `
	      ).run(now, now, deletion.externalId);
	      return deletion;
	    },
	    resetItemForRetry(itemId) {
	      const now = new Date().toISOString();
	      raw.prepare(
	        `
	        update grocery_items
	        set status = case when exists (select 1 from chosen_products where grocery_item_id = ?) then 'approved' else 'needs_review' end,
	            cart_status = 'not_added',
	            error_message = null,
	            updated_at = ?
	        where id = ? and status in ('failed', 'manual_action')
	      `
	      ).run(itemId, now, itemId);
	    },
	    updateWalmartSession(status, message, needsManualAction) {
      const now = new Date().toISOString();
      raw.prepare(
        `
        update walmart_session_state
        set status = ?, last_checked_at = ?, last_success_at = case when ? = 'ready' then ? else last_success_at end,
            error_message = ?, needs_manual_action = ?
        where id = 1
	      `
	      ).run(status, now, status, now, message, needsManualAction ? 1 : 0);
	    },
	    setSyncState(key, status, errorMessage = null) {
	      const now = new Date().toISOString();
	      raw.prepare(
	        `
	        insert into sync_state (key, status, last_started_at, last_finished_at, error_message)
	        values (@key, @status, @now, @now, @errorMessage)
	        on conflict(key) do update set
	          status = excluded.status,
	          last_started_at = excluded.last_started_at,
	          last_finished_at = excluded.last_finished_at,
	          error_message = excluded.error_message
	      `
	      ).run({ key, status, now, errorMessage });
	    },
	    listSyncState() {
	      return raw.prepare("select * from sync_state order by key").all() as Record<string, unknown>[];
	    },
	    rejectItem(itemId) {
	      const now = new Date().toISOString();
	      raw.prepare("update grocery_items set status = 'skipped', updated_at = ? where id = ?").run(now, itemId);
	    }
	  };
	}

function listItemsQuery(
  raw: Database.Database,
  includeInactive: boolean,
  statuses: string[] | null,
  limit = 500
): Record<string, unknown>[] {
  const filters: string[] = [];
  const params: Record<string, unknown> = { limit };
  if (!includeInactive) filters.push("gi.deleted_at is null", "gi.status not in ('deleted', 'fulfilled')");
  if (statuses) {
    filters.push(`gi.status in (${statuses.map((_, index) => `@status${index}`).join(", ")})`);
    statuses.forEach((status, index) => {
      params[`status${index}`] = status;
    });
  }
  const where = filters.length ? `where ${filters.join(" and ")}` : "";
  return raw
    .prepare(
      `
      select
        gi.*,
        r.external_id,
        r.list_id,
        r.list_name,
        r.title as reminder_title,
        r.completed as reminder_completed,
        r.deleted_at as reminder_deleted_at,
        cp.title as chosen_title,
        cp.url as chosen_url,
        cp.image_url as chosen_image_url,
        cp.chosen_at,
        pc.id as candidate_id,
        pc.title as candidate_title,
        pc.url as candidate_url,
        pc.image_url as candidate_image_url,
        pc.price_text as candidate_price_text,
        pc.size_text as candidate_size_text,
        pc.availability_text as candidate_availability_text,
        pc.confidence as candidate_confidence,
        pc.source as candidate_source
      from grocery_items gi
      join reminders r on r.id = gi.reminder_id
      left join chosen_products cp on cp.grocery_item_id = gi.id
      left join product_candidates pc on pc.id = (
        select id from product_candidates
        where grocery_item_id = gi.id
        order by confidence desc, id asc
        limit 1
      )
      ${where}
      order by
        case gi.status
          when 'needs_review' then 1
          when 'manual_action' then 2
          when 'parsed' then 3
          when 'approved' then 4
          when 'adding' then 5
          when 'added_to_cart' then 6
          else 9
        end,
        gi.created_at asc,
        gi.id asc
      limit @limit
    `
    )
    .all(params) as Record<string, unknown>[];
}

function reminderDeletionForItem(raw: Database.Database, itemId: number): DashboardDeletion | null {
  const row = raw
    .prepare(
      `
      select r.external_id
      from grocery_items gi
      join reminders r on r.id = gi.reminder_id
      where gi.id = ?
    `
    )
    .get(itemId) as { external_id: string } | undefined;
  return row ? { externalId: row.external_id, action: "complete" } : null;
}

function migrateExistingDatabase(raw: Database.Database): void {
  ensureColumn(raw, "reminders", "list_name", "text");
  ensureColumn(raw, "reminders", "completed_at", "text");
  ensureColumn(raw, "reminders", "deleted_at", "text");
  ensureColumn(raw, "grocery_items", "cart_status", "text not null default 'not_added'");
  ensureColumn(raw, "grocery_items", "matched_at", "text");
  ensureColumn(raw, "grocery_items", "approved_at", "text");
  ensureColumn(raw, "grocery_items", "added_at", "text");
  ensureColumn(raw, "grocery_items", "ordered_at", "text");
  ensureColumn(raw, "grocery_items", "fulfilled_at", "text");
  ensureColumn(raw, "grocery_items", "deleted_at", "text");
  ensureColumn(raw, "product_candidates", "catalog_item_id", "integer references walmart_catalog_items(id)");
  ensureColumn(raw, "chosen_products", "image_url", "text");
  raw.prepare(
    "insert or ignore into schema_migrations (name, applied_at) values ('2026-05-19-local-first-state', ?)"
  ).run(new Date().toISOString());
}

function ensureColumn(raw: Database.Database, table: string, column: string, definition: string): void {
  const columns = raw.prepare(`pragma table_info(${table})`).all() as { name: string }[];
  if (columns.some((entry) => entry.name === column)) return;
  raw.exec(`alter table ${table} add column ${column} ${definition}`);
}
