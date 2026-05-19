import Database from "better-sqlite3";
import { parseGroceryText } from "../parser/groceryParser.js";
import { schemaSql } from "./schema.js";

export type ReminderInput = {
  externalId: string;
  listId: string;
  title: string;
  notes: string | null;
  completed: boolean;
};

export type ProductCandidateInput = {
  title: string;
  url: string;
  priceText: string | null;
  sizeText: string | null;
  availabilityText: string | null;
  imageUrl: string | null;
  confidence: number;
  source: string;
};

export type AppDatabase = {
  raw: Database.Database;
  upsertReminder(input: ReminderInput): void;
  listReminders(): Record<string, unknown>[];
  listApprovals(): Record<string, unknown>[];
  listHistory(): Record<string, unknown>[];
  replaceCandidates(itemId: number, candidates: ProductCandidateInput[]): void;
  approveItem(input: { itemId: number; candidateId?: number | null; url: string; title: string; chosenBy: string }): void;
  getChosenProduct(itemId: number): Record<string, unknown> | null;
  markItemAdding(itemId: number): void;
  markItemAdded(itemId: number, message: string): void;
  markItemFailed(itemId: number, message: string): void;
  updateWalmartSession(status: string, message: string | null, needsManualAction: boolean): void;
  rejectItem(itemId: number): void;
};

export function createDatabase(path: string): AppDatabase {
  const raw = new Database(path);
  raw.pragma("journal_mode = WAL");
  raw.exec(schemaSql);

  return {
    raw,
    upsertReminder(input) {
      const now = new Date().toISOString();
      raw.prepare(
        `
        insert into reminders (external_id, list_id, title, notes, completed, first_seen_at, last_seen_at)
        values (@externalId, @listId, @title, @notes, @completed, @now, @now)
        on conflict(external_id) do update set
          list_id = excluded.list_id,
          title = excluded.title,
          notes = excluded.notes,
          completed = excluded.completed,
          last_seen_at = excluded.last_seen_at
      `
      ).run({ ...input, completed: input.completed ? 1 : 0, now });

      const reminder = raw.prepare("select id from reminders where external_id = ?").get(input.externalId) as
        | { id: number }
        | undefined;
      if (!reminder || input.completed) return;

      const existing = raw
        .prepare("select id, status from grocery_items where reminder_id = ? order by id desc limit 1")
        .get(reminder.id) as { id: number; status: string } | undefined;
      if (existing && ["matched", "adding", "added", "skipped"].includes(existing.status)) return;

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
            updated_at = @now
          where id = @id
        `
        ).run({ ...parsed, id: existing.id, now });
      } else {
        raw.prepare(
          `
          insert into grocery_items (
            reminder_id, raw_text, normalized_text, quantity_value, quantity_unit,
            brand_hint, product_terms, status, created_at, updated_at
          )
          values (
            @reminderId, @rawText, @normalizedText, @quantityValue, @quantityUnit,
            @brandHint, @productTerms, 'parsed', @now, @now
          )
        `
        ).run({ ...parsed, reminderId: reminder.id, now });
      }
    },
    listReminders() {
      return raw.prepare("select * from reminders order by id").all() as Record<string, unknown>[];
    },
    listApprovals() {
      return raw
        .prepare(
          `
          select
            gi.*,
            r.external_id,
            r.title as reminder_title,
            pc.id as candidate_id,
            pc.title as candidate_title,
            pc.url as candidate_url,
            pc.image_url as candidate_image_url,
            pc.price_text as candidate_price_text,
            pc.size_text as candidate_size_text,
            pc.availability_text as candidate_availability_text
          from grocery_items gi
          join reminders r on r.id = gi.reminder_id
          left join product_candidates pc on pc.id = (
            select id from product_candidates
            where grocery_item_id = gi.id
            order by confidence desc, id asc
            limit 1
          )
          where gi.status in ('needs_review', 'parsed', 'failed')
          order by gi.created_at asc
        `
        )
        .all() as Record<string, unknown>[];
    },
    listHistory() {
      return raw
        .prepare(
          `
          select
            gi.*,
            r.external_id,
            r.title as reminder_title,
            cp.title as chosen_title,
            cp.url as chosen_url,
            cp.chosen_at,
            pc.id as candidate_id,
            pc.title as candidate_title,
            pc.url as candidate_url,
            pc.image_url as candidate_image_url,
            pc.price_text as candidate_price_text,
            pc.size_text as candidate_size_text,
            pc.availability_text as candidate_availability_text
          from grocery_items gi
          join reminders r on r.id = gi.reminder_id
          left join chosen_products cp on cp.grocery_item_id = gi.id
          left join product_candidates pc on pc.id = (
            select id from product_candidates
            where grocery_item_id = gi.id
            order by confidence desc, id asc
            limit 1
          )
          order by gi.updated_at desc, gi.id desc
          limit 50
        `
        )
        .all() as Record<string, unknown>[];
    },
    replaceCandidates(itemId, candidates) {
      const now = new Date().toISOString();
      const tx = raw.transaction(() => {
        raw.prepare("delete from product_candidates where grocery_item_id = ?").run(itemId);
        for (const candidate of candidates) {
          raw.prepare(
            `
            insert into product_candidates (
              grocery_item_id, title, url, price_text, size_text, availability_text,
              image_url, confidence, source, captured_at
            )
            values (
              @itemId, @title, @url, @priceText, @sizeText, @availabilityText,
              @imageUrl, @confidence, @source, @now
            )
          `
          ).run({ ...candidate, itemId, now });
        }
        raw.prepare("update grocery_items set status = 'needs_review', updated_at = ? where id = ?").run(now, itemId);
      });
      tx();
    },
    approveItem(input) {
      const now = new Date().toISOString();
      const result = raw
        .prepare("update grocery_items set status = 'matched', updated_at = ? where id = ? and status != 'added'")
        .run(now, input.itemId);
      if (result.changes === 0) throw new Error("No approvable grocery item found.");
      raw.prepare(
        `
        insert into chosen_products (grocery_item_id, candidate_id, url, title, chosen_by, chosen_at)
        values (@itemId, @candidateId, @url, @title, @chosenBy, @now)
        on conflict(grocery_item_id) do update set
          candidate_id = excluded.candidate_id,
          url = excluded.url,
          title = excluded.title,
          chosen_by = excluded.chosen_by,
          chosen_at = excluded.chosen_at
      `
      ).run({ candidateId: input.candidateId ?? null, ...input, now });
    },
    getChosenProduct(itemId) {
      return (
        (raw
          .prepare(
            `
            select cp.*, gi.raw_text
            from chosen_products cp
            join grocery_items gi on gi.id = cp.grocery_item_id
            where cp.grocery_item_id = ?
          `
          )
          .get(itemId) as Record<string, unknown> | undefined) ?? null
      );
    },
    markItemAdding(itemId) {
      const now = new Date().toISOString();
      raw.prepare("update grocery_items set status = 'adding', error_message = null, updated_at = ? where id = ?").run(
        now,
        itemId
      );
      raw.prepare(
        "insert into automation_runs (grocery_item_id, action, status, started_at) values (?, 'add_to_cart', 'running', ?)"
      ).run(itemId, now);
    },
    markItemAdded(itemId, message) {
      const now = new Date().toISOString();
      raw.prepare("update grocery_items set status = 'added', error_message = ?, updated_at = ? where id = ?").run(
        message,
        now,
        itemId
      );
      raw.prepare(
        `
        update automation_runs
        set status = 'added', finished_at = ?, error_message = ?
        where id = (select id from automation_runs where grocery_item_id = ? order by id desc limit 1)
      `
      ).run(now, message, itemId);
    },
    markItemFailed(itemId, message) {
      const now = new Date().toISOString();
      raw.prepare("update grocery_items set status = 'failed', error_message = ?, updated_at = ? where id = ?").run(
        message,
        now,
        itemId
      );
      raw.prepare(
        `
        update automation_runs
        set status = 'failed', finished_at = ?, error_message = ?
        where id = (select id from automation_runs where grocery_item_id = ? order by id desc limit 1)
      `
      ).run(now, message, itemId);
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
    rejectItem(itemId) {
      const now = new Date().toISOString();
      raw.prepare("update grocery_items set status = 'skipped', updated_at = ? where id = ?").run(now, itemId);
    }
  };
}
