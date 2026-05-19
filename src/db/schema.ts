export const schemaSql = `
create table if not exists reminders (
  id integer primary key,
  external_id text unique not null,
  list_id text not null,
  title text not null,
  notes text,
  completed integer not null default 0,
  first_seen_at text not null,
  last_seen_at text not null
);

create table if not exists grocery_items (
  id integer primary key,
  reminder_id integer not null references reminders(id),
  raw_text text not null,
  normalized_text text not null,
  quantity_value real,
  quantity_unit text,
  brand_hint text,
  product_terms text not null,
  status text not null,
  error_message text,
  created_at text not null,
  updated_at text not null
);

create table if not exists walmart_reorder_items (
  id integer primary key,
  walmart_product_id text,
  title text not null,
  normalized_title text not null,
  url text not null,
  price_text text,
  size_text text,
  brand text,
  image_url text,
  availability_text text,
  last_ordered_text text,
  last_seen_at text not null,
  first_seen_at text not null,
  active integer not null default 1,
  unique(url)
);

create table if not exists product_candidates (
  id integer primary key,
  grocery_item_id integer not null references grocery_items(id),
  walmart_product_id text,
  title text not null,
  url text not null,
  price_text text,
  size_text text,
  availability_text text,
  image_url text,
  confidence real not null,
  source text not null,
  captured_at text not null
);

create table if not exists phrase_mappings (
  id integer primary key,
  phrase text unique not null,
  walmart_product_id text,
  url text not null,
  title text not null,
  default_quantity_value real,
  default_quantity_unit text,
  trusted integer not null default 0,
  created_at text not null,
  updated_at text not null
);

create table if not exists chosen_products (
  id integer primary key,
  grocery_item_id integer unique not null references grocery_items(id),
  candidate_id integer references product_candidates(id),
  walmart_product_id text,
  title text,
  url text not null,
  chosen_by text not null,
  chosen_at text not null
);

create table if not exists automation_runs (
  id integer primary key,
  grocery_item_id integer references grocery_items(id),
  action text not null,
  status text not null,
  started_at text not null,
  finished_at text,
  error_message text
);

create table if not exists dashboard_sessions (
  id integer primary key,
  device_name text,
  token_hash text not null,
  created_at text not null,
  last_seen_at text,
  revoked_at text
);

create table if not exists walmart_session_state (
  id integer primary key check (id = 1),
  status text not null,
  last_checked_at text,
  last_success_at text,
  error_message text,
  needs_manual_action integer not null default 0
);

insert or ignore into walmart_session_state (id, status, needs_manual_action)
values (1, 'unknown', 0);
`;
