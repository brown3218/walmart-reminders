import Database from "better-sqlite3";
import { matchAgainstReorderCatalog, type ReorderCatalogItem } from "../matching/reorderMatcher.js";
import { findFulfilledItems, type FulfilledMatch, type WalmartOrderSnapshot } from "../orders/reconciliation.js";
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

export type CatalogItemInput = {
  productId: string | null;
  title: string;
  normalizedTitle: string;
  url: string;
  imageUrl: string | null;
  priceText: string | null;
  sizeText: string | null;
  brand: string | null;
  source: string;
};

export type MatchThresholds = {
  autoAddThreshold: number;
  proposeThreshold: number;
};

export type MatchPendingResult = {
  autoMatched: number;
  needsReview: number;
  noMatch: number;
};

export type OrderInput = WalmartOrderSnapshot & {
  status?: string | null;
  items: Array<{
    productId?: string | null;
    title: string;
    url?: string | null;
    imageUrl?: string | null;
    priceText?: string | null;
    quantity?: number | null;
  }>;
};

export type ListItemsOptions = {
  includeInactive?: boolean;
};

export type DashboardDeletion = {
  externalId: string;
  action: "complete" | "delete";
  needsCartRemoval: boolean;
  itemId: number;
  productTitle?: string;
  productUrl?: string | null;
};

export type ReconciledFulfillment = FulfilledMatch & {
  reminder: DashboardDeletion | null;
};

export type AppDatabase = {
  raw: Database.Database;
  upsertReminder(input: ReminderInput): void;
  listReminders(): Record<string, unknown>[];
  listItems(options?: ListItemsOptions): Record<string, unknown>[];
  listApprovals(): Record<string, unknown>[];
  listHistory(): Record<string, unknown>[];
  upsertCatalogItems(items: CatalogItemInput[]): number;
  matchPendingItems(thresholds: MatchThresholds): MatchPendingResult;
  upsertOrders(orders: OrderInput[]): number;
  reconcileOrders(): ReconciledFulfillment[];
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
  markItemCartRemoved(itemId: number, message: string): void;
  markItemCartRemovalManual(itemId: number, message: string): void;
  markItemManualAction(itemId: number, message: string): void;
  markItemFailed(itemId: number, message: string): void;
  markItemOrdered(itemId: number, message: string): void;
  fulfillItem(itemId: number, source: string): DashboardDeletion | null;
  deleteItem(itemId: number, source: string): DashboardDeletion;
  resetItemForRetry(itemId: number): void;
  updateWalmartSession(status: string, message: string | null, needsManualAction: boolean): void;
  setSyncState(key: string, status: string, errorMessage?: string | null): void;
  recordAutomationRun(action: string, status: string, message?: string | null): void;
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
	        .prepare("select id, status, raw_text from grocery_items where reminder_id = ? order by id desc limit 1")
	        .get(reminder.id) as { id: number; status: string; raw_text: string } | undefined;
	      const titleChanged = Boolean(existing && existing.raw_text !== input.title);
	      if (existing && ["fulfilled", "deleted"].includes(existing.status)) {
	        return;
	      }
	      if (
	        existing &&
	        !titleChanged &&
	        ["auto_matched", "approved", "adding", "added_to_cart", "manual_action", "ordered", "fulfilled", "skipped"].includes(
	          existing.status
	        )
	      ) {
	        return;
	      }

	      const parsed = parseGroceryText(input.title);
	      if (existing) {
	        if (titleChanged) {
	          raw.prepare("delete from product_candidates where grocery_item_id = ?").run(existing.id);
	          raw.prepare("delete from chosen_products where grocery_item_id = ?").run(existing.id);
	        }
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
	            matched_at = null,
	            approved_at = null,
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
	    upsertCatalogItems(items) {
	      const now = new Date().toISOString();
	      const tx = raw.transaction(() => {
	        for (const item of items) {
	          raw.prepare(
	            `
	            insert into walmart_catalog_items (
	              product_id, title, normalized_title, url, image_url, price_text,
	              size_text, brand, source, first_seen_at, last_seen_at, active
	            )
	            values (
	              @productId, @title, @normalizedTitle, @url, @imageUrl, @priceText,
	              @sizeText, @brand, @source, @now, @now, 1
	            )
	            on conflict(url) do update set
	              product_id = excluded.product_id,
	              title = excluded.title,
	              normalized_title = excluded.normalized_title,
	              image_url = excluded.image_url,
	              price_text = excluded.price_text,
	              size_text = excluded.size_text,
	              brand = excluded.brand,
	              source = excluded.source,
	              last_seen_at = excluded.last_seen_at,
	              active = 1
	          `
	          ).run({ ...item, now });
	        }
	      });
	      tx();
	      return items.length;
	    },
	    matchPendingItems(thresholds) {
	      const pending = raw
	        .prepare(
	          `
	          select gi.id, gi.raw_text, gi.normalized_text
	          from grocery_items gi
	          join reminders r on r.id = gi.reminder_id
	          where gi.deleted_at is null
	            and r.completed = 0
	            and gi.status in ('parsed', 'no_match', 'failed')
	          order by gi.created_at asc, gi.id asc
	        `
	        )
	        .all() as { id: number; raw_text: string; normalized_text: string }[];
	      const catalog = raw
	        .prepare(
	          `
	          select
	            id,
	            product_id,
	            title,
	            normalized_title as normalizedTitle,
	            url,
	            brand,
	            size_text as sizeText,
	            price_text as priceText,
	            image_url as imageUrl,
	            source
	          from walmart_catalog_items
	          where active = 1
	          order by
	            case source when 'reorder' then 1 when 'favorites' then 2 when 'manual' then 3 else 4 end,
	            last_seen_at desc
	        `
	        )
	        .all() as Array<
	        ReorderCatalogItem & {
	          product_id: string | null;
	          priceText: string | null;
	          imageUrl: string | null;
	          source: string;
	        }
	      >;
	      const result: MatchPendingResult = { autoMatched: 0, needsReview: 0, noMatch: 0 };
	      const now = new Date().toISOString();

	      for (const item of pending) {
	        const trusted = raw
	          .prepare("select * from phrase_mappings where phrase = ? and trusted = 1")
	          .get(item.normalized_text) as
	          | { walmart_product_id: string | null; url: string; title: string }
	          | undefined;
	        if (trusted) {
	          chooseProduct(raw, {
	            itemId: item.id,
	            candidateId: null,
	            walmartProductId: trusted.walmart_product_id,
	            url: trusted.url,
	            title: trusted.title,
	            imageUrl: null,
	            chosenBy: "trusted",
	            status: "auto_matched",
	            now
	          });
	          result.autoMatched += 1;
	          continue;
	        }

	        const decision = matchAgainstReorderCatalog(parseGroceryText(item.raw_text), catalog);
	        const best = decision.bestMatch
	          ? catalog.find((candidate) => candidate.id === decision.bestMatch?.id)
	          : undefined;
	        if (!best || decision.confidence < thresholds.proposeThreshold) {
	          raw.prepare(
	            "update grocery_items set status = 'no_match', error_message = null, updated_at = ? where id = ?"
	          ).run(now, item.id);
	          result.noMatch += 1;
	          continue;
	        }

	        if (decision.confidence >= thresholds.autoAddThreshold && ["reorder", "favorites", "manual"].includes(best.source)) {
	          chooseProduct(raw, {
	            itemId: item.id,
	            candidateId: null,
	            walmartProductId: best.product_id,
	            url: best.url,
	            title: best.title,
	            imageUrl: best.imageUrl,
	            chosenBy: "auto",
	            status: "auto_matched",
	            now
	          });
	          result.autoMatched += 1;
	          continue;
	        }

	        raw.prepare("delete from product_candidates where grocery_item_id = ?").run(item.id);
	        raw.prepare(
	          `
	          insert into product_candidates (
	            grocery_item_id, catalog_item_id, walmart_product_id, title, url, price_text,
	            size_text, availability_text, image_url, confidence, source, captured_at
	          )
	          values (?, ?, ?, ?, ?, ?, ?, null, ?, ?, ?, ?)
	        `
	        ).run(
	          item.id,
	          best.id,
	          best.product_id,
	          best.title,
	          best.url,
	          best.priceText,
	          best.sizeText ?? null,
	          best.imageUrl,
	          decision.confidence,
	          best.source,
	          now
	        );
	        raw.prepare("update grocery_items set status = 'needs_review', error_message = null, updated_at = ? where id = ?").run(
	          now,
	          item.id
	        );
	        result.needsReview += 1;
	      }

	      return result;
	    },
	    upsertOrders(orders) {
	      const now = new Date().toISOString();
	      const tx = raw.transaction(() => {
	        for (const order of orders) {
	          raw.prepare(
	            `
	            insert into walmart_orders (order_id, placed_at, status, source, raw_json, first_seen_at, last_seen_at)
	            values (@orderId, @placedAt, @status, 'scrape', @rawJson, @now, @now)
	            on conflict(order_id) do update set
	              placed_at = excluded.placed_at,
	              status = excluded.status,
	              raw_json = excluded.raw_json,
	              last_seen_at = excluded.last_seen_at
	          `
	          ).run({
	            orderId: order.orderId,
	            placedAt: order.placedAt,
	            status: order.status ?? null,
	            rawJson: JSON.stringify(order),
	            now
	          });
	          const orderRow = raw.prepare("select id from walmart_orders where order_id = ?").get(order.orderId) as
	            | { id: number }
	            | undefined;
	          if (!orderRow) continue;
	          for (const item of order.items) {
	            raw.prepare(
	              `
	              insert into walmart_order_items (
	                order_id, product_id, title, normalized_title, url, image_url, price_text, quantity
	              )
	              values (@orderRowId, @productId, @title, @normalizedTitle, @url, @imageUrl, @priceText, @quantity)
	              on conflict(order_id, title, url) do update set
	                product_id = excluded.product_id,
	                normalized_title = excluded.normalized_title,
	                image_url = excluded.image_url,
	                price_text = excluded.price_text,
	                quantity = excluded.quantity
	            `
	            ).run({
	              orderRowId: orderRow.id,
	              productId: item.productId ?? null,
	              title: item.title,
	              normalizedTitle: parseGroceryText(item.title).normalizedText,
	              url: item.url ?? null,
	              imageUrl: item.imageUrl ?? null,
	              priceText: item.priceText ?? null,
	              quantity: item.quantity ?? null
	            });
	          }
	        }
	      });
	      tx();
	      return orders.length;
	    },
	    reconcileOrders() {
	      const items = raw
	        .prepare(
	          `
	          select
	            gi.id as itemId,
	            gi.status,
	            cp.walmart_product_id as productId,
	            cp.url as productUrl,
	            coalesce(cp.title, gi.raw_text) as productTitle
	          from grocery_items gi
	          left join chosen_products cp on cp.grocery_item_id = gi.id
	          where gi.deleted_at is null
	            and gi.status in ('approved', 'adding', 'added_to_cart', 'manual_action', 'ordered')
	        `
	        )
	        .all() as Array<{ itemId: number; status: string; productId: string | null; productUrl: string | null; productTitle: string }>;
	      const orderRows = raw
	        .prepare("select id, order_id as orderId, placed_at as placedAt from walmart_orders order by coalesce(placed_at, last_seen_at) desc")
	        .all() as Array<{ id: number; orderId: string; placedAt: string | null }>;
	      const orders = orderRows.map((order) => ({
	        orderId: order.orderId,
	        placedAt: order.placedAt,
	        items: raw
	          .prepare("select title, url, product_id as productId from walmart_order_items where order_id = ?")
	          .all(order.id) as Array<{ title: string; url: string | null; productId: string | null }>
	      }));
	      const matches: ReconciledFulfillment[] = findFulfilledItems(items, orders).map((match) => ({
	        ...match,
	        reminder: null
	      }));
	      for (const match of matches) {
	        this.markItemOrdered(match.itemId, `Matched Walmart order ${match.orderId}.`);
	        match.reminder = this.fulfillItem(match.itemId, "order_reconciliation");
	      }
	      return matches;
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
	        raw.prepare("update grocery_items set status = ?, error_message = null, updated_at = ? where id = ?").run(
	          candidates.length > 0 ? "needs_review" : "no_match",
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
	      const candidate = input.candidateId
	        ? (raw
	            .prepare("select walmart_product_id, image_url from product_candidates where id = ? and grocery_item_id = ?")
	            .get(input.candidateId, input.itemId) as { walmart_product_id: string | null; image_url: string | null } | undefined)
	        : undefined;
	      const walmartProductId = input.walmartProductId ?? candidate?.walmart_product_id ?? null;
	      const imageUrl = input.imageUrl ?? candidate?.image_url ?? null;
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
	        ...input,
	        candidateId: input.candidateId ?? null,
	        walmartProductId,
	        imageUrl,
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
	        walmartProductId,
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
	        no_match: 0,
	        removed: 0,
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
	    markItemCartRemoved(itemId, message) {
	      const now = new Date().toISOString();
	      raw.prepare("update grocery_items set cart_status = 'removed', error_message = ?, updated_at = ? where id = ?").run(
	        message,
	        now,
	        itemId
	      );
	      raw.prepare(
	        "insert into automation_runs (grocery_item_id, action, status, started_at, finished_at, error_message) values (?, 'remove_from_cart', 'removed', ?, ?, ?)"
	      ).run(itemId, now, now, message);
	    },
	    markItemCartRemovalManual(itemId, message) {
	      const now = new Date().toISOString();
	      raw.prepare(
	        "update grocery_items set cart_status = 'manual_action', error_message = ?, updated_at = ? where id = ?"
	      ).run(message, now, itemId);
	      raw.prepare(
	        "insert into automation_runs (grocery_item_id, action, status, started_at, finished_at, error_message) values (?, 'remove_from_cart', 'manual_action', ?, ?, ?)"
	      ).run(itemId, now, now, message);
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
	        set status = 'deleted',
	            cart_status = case when ? = 1 then 'manual_action' else cart_status end,
	            error_message = case
	              when ? = 1 then 'Item was removed locally; remove it from the Walmart cart if it is still present.'
	              else error_message
	            end,
	            deleted_at = coalesce(deleted_at, ?),
	            updated_at = ?
	        where id = ?
	      `
	      ).run(deletion.needsCartRemoval ? 1 : 0, deletion.needsCartRemoval ? 1 : 0, now, now, itemId);
	      if (deletion.needsCartRemoval) {
	        raw.prepare(
	          `
	          insert into automation_runs (grocery_item_id, action, status, started_at, finished_at, error_message)
	          values (?, 'remove_from_cart', 'manual_action', ?, ?, ?)
	        `
	        ).run(
	          itemId,
	          now,
	          now,
	          "Item was removed locally; remove it from the Walmart cart if it is still present."
	        );
	      }
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
	    recordAutomationRun(action, status, message = null) {
	      const now = new Date().toISOString();
	      raw.prepare(
	        `
	        insert into automation_runs (grocery_item_id, action, status, started_at, finished_at, error_message)
	        values (null, ?, ?, ?, ?, ?)
	      `
	      ).run(action, status, now, now, message);
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
      select r.external_id, gi.cart_status, gi.status
        , coalesce(cp.title, gi.raw_text) as product_title
        , cp.url as product_url
      from grocery_items gi
      join reminders r on r.id = gi.reminder_id
      left join chosen_products cp on cp.grocery_item_id = gi.id
      where gi.id = ?
    `
    )
    .get(itemId) as
    | { external_id: string; cart_status: string; status: string; product_title: string; product_url: string | null }
    | undefined;
  return row
    ? {
        externalId: row.external_id,
        action: "complete",
        itemId,
        needsCartRemoval: row.cart_status === "added" || row.status === "added_to_cart",
        productTitle: row.product_title,
        productUrl: row.product_url
      }
    : null;
}

function chooseProduct(
  raw: Database.Database,
  input: {
    itemId: number;
    candidateId: number | null;
    walmartProductId: string | null;
    url: string;
    title: string;
    imageUrl: string | null;
    chosenBy: string;
    status: "auto_matched" | "approved";
    now: string;
  }
): void {
  raw.prepare(
    `
    update grocery_items
    set status = @status,
        matched_at = coalesce(matched_at, @now),
        approved_at = case when @status = 'approved' then coalesce(approved_at, @now) else approved_at end,
        error_message = null,
        updated_at = @now
    where id = @itemId and status not in ('added_to_cart', 'ordered', 'fulfilled', 'deleted')
  `
  ).run(input);
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
  ).run(input);
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
