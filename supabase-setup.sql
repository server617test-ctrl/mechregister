-- ============================================================
-- MECHANIC SHOP REGISTER - Supabase setup
-- Run this once in your Supabase project:
--   Dashboard -> SQL Editor -> New query -> paste -> Run
-- ============================================================

-- Shop settings (single row: name, tagline, logo, theme colors, webhook, info text)
create table if not exists shop_config (
  id int primary key default 1,
  data jsonb not null
);

-- Items on the shelf
create table if not exists items (
  id text primary key,
  name text not null,
  price numeric not null default 0,
  category text default 'Misc',
  img text
);

-- Deals / bundles
create table if not exists deals (
  id text primary key,
  name text not null,
  description text default '',
  price numeric not null default 0,
  img text
);

-- Employees with PIN + role ('employee' or 'management')
create table if not exists employees (
  id text primary key,
  name text not null,
  pin text not null,
  role text not null default 'employee'
);

-- ------------------------------------------------------------
-- Row Level Security: open read/write for the anon key.
-- This is fine for an RP shop tool; see README for hardening tips.
-- ------------------------------------------------------------
alter table shop_config enable row level security;
alter table items enable row level security;
alter table deals enable row level security;
alter table employees enable row level security;

create policy "open access" on shop_config for all using (true) with check (true);
create policy "open access" on items for all using (true) with check (true);
create policy "open access" on deals for all using (true) with check (true);
create policy "open access" on employees for all using (true) with check (true);

-- ------------------------------------------------------------
-- Seed data (safe to re-run: does nothing if rows already exist)
-- ------------------------------------------------------------
insert into shop_config (id, data) values (1, '{
  "shopName": "Benny''s Custom Works",
  "tagline": "LOS SANTOS · MECHANIC & CUSTOMS",
  "logo": null,
  "webhook": "",
  "info": "Welcome to the shop!\n\nHours: 24/7 (whenever a mechanic is on duty)\nLocation: Strawberry, Los Santos\n\nHouse rules:\n• Payment before parts leave the lot\n• Company discount requires manager approval\n• Log every sale through the register",
  "theme": {
    "bg": "#101418",
    "panel": "#1a2027",
    "accent": "#f5a623",
    "accent2": "#2e88ff",
    "text": "#e8edf2"
  }
}'::jsonb)
on conflict (id) do nothing;

insert into employees (id, name, pin, role) values
  ('em1', 'Boss', '1234', 'management')
on conflict (id) do nothing;

insert into items (id, name, price, category) values
  ('it1', 'Repair Kit', 350, 'Parts'),
  ('it2', 'Advanced Repair Kit', 750, 'Parts'),
  ('it3', 'Engine Tune (Lv.1)', 4500, 'Performance'),
  ('it4', 'Turbo Install', 12000, 'Performance'),
  ('it5', 'Full Respray', 2500, 'Cosmetic'),
  ('it6', 'Window Tint', 900, 'Cosmetic'),
  ('it7', 'NOS Bottle', 1800, 'Performance'),
  ('it8', 'Cleaning Kit', 150, 'Parts')
on conflict (id) do nothing;

insert into deals (id, name, description, price) values
  ('dl1', 'Fresh Start Bundle', 'Repair kit + full respray + tint', 3400),
  ('dl2', 'Street Racer Pack', 'Engine tune + turbo + NOS', 16500)
on conflict (id) do nothing;
