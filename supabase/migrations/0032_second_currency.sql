-- broke: accounts you add by hand can have their own currency (a Thai bank in THB while home is AUD), and totals can
-- also show in a second currency (profile.currency2). Money is still never added across currencies unconverted: each
-- transaction converts at the ECB rate for its own day (fx, migration 0015). A null currency still means home.

-- Manual accounts pick their currency when they are made. Bank-linked accounts get theirs from the bank.
alter table public.accounts drop constraint if exists accounts_currency_code;
alter table public.accounts add constraint accounts_currency_code check (currency is null or currency ~ '^[A-Z]{3}$') not valid;
grant insert (currency) on public.accounts to authenticated;

-- The second currency: profile.currency2 in the caller's auth metadata, when it is set and differs from home. Else null.
create or replace function public.second_currency() returns text
language sql stable security definer set search_path = '' as $$
  select nullif(upper(u.raw_user_meta_data #>> '{profile,currency2}'), public.home_currency()) from auth.users u
  where u.id = (select auth.uid()) and u.raw_user_meta_data #>> '{profile,currency2}' ~* '^[a-z]{3}$'
$$;

-- money_rows (0014, 0015) can now total in any currency: cur, else home. Each row converts at its own day's rate.
-- money_by_month and spend_by_day call it with two arguments, so they keep using home. Change with src/lib/data.ts.
drop function if exists public.money_rows(date, date);
create or replace function public.money_rows(start_date date, end_date date default null, cur text default null)
returns table (date date, category_id uuid, spend numeric, income numeric)
language sql stable set search_path = '' as $$
  with b as (
    select (select id from public.categories where user_id is null and key = 'OTHER') as other,
           (select id from public.categories where user_id is null and key = 'INCOME') as income,
           public.home_currency() as home,
           coalesce(upper(cur), public.home_currency()) as target
  ), r as (
    select t.date, t.amount * public.fx(coalesce(t.currency, a.currency, b.home), b.target, t.date) as amount,
      coalesce(t.category_id, case when t.amount > 0 then b.other else b.income end) as category_id,
      not t.ignored and a.included as counted,
      coalesce(c.kind, case when t.amount > 0 then 'spend' else 'income' end) as kind
    from public.transactions t
    join public.accounts a on a.id = t.account_id
    left join public.categories c on c.id = t.category_id
    cross join b
    where t.user_id = (select auth.uid()) and t.date >= start_date and (end_date is null or t.date <= end_date)
  )
  select date, category_id,
    case when counted and kind = 'spend' and amount > 0 then amount else 0 end,
    case when counted and kind = 'income' and amount is not null then -amount else 0 end
  from r
$$;

-- Spend and income over a range in one currency (home when cur is null). The home page's second-currency line.
create or replace function public.money_total(start_date date, end_date date default null, cur text default null)
returns table (spend numeric, income numeric)
language sql stable set search_path = '' as $$
  select coalesce(sum(spend), 0), coalesce(sum(income), 0) from public.money_rows(start_date, end_date, cur)
$$;

-- txn_totals (0028) converted again, as 0015 did (0028 dropped the conversion), and in cur when given.
drop function if exists public.txn_totals(text, uuid, uuid, text, date, date);
create or replace function public.txn_totals(q text default null, cat uuid default null, acct uuid default null, tag text default null,
  start_date date default null, end_date date default null, cur text default null)
returns table (money_out numeric, money_in numeric)
language sql stable set search_path = '' as $$
  with h as (select public.home_currency() as home, coalesce(upper(cur), public.home_currency()) as target), r as (
    select t.amount * public.fx(coalesce(t.currency, a.currency, h.home), h.target, t.date) as amount
    from public.transactions t
    join public.accounts a on a.id = t.account_id
    left join public.categories c on c.id = t.category_id
    cross join h
    where t.user_id = (select auth.uid()) and not t.ignored and c.kind is distinct from 'transfer'
      and (q is null or t.name ilike '%' || q || '%' or t.merchant_name ilike '%' || q || '%' or t.custom_name ilike '%' || q || '%')
      and (cat is null or t.category_id = cat)
      and (acct is null or t.account_id = acct)
      and (tag is null or t.tags @> array[tag])
      and (start_date is null or t.date >= start_date)
      and (end_date is null or t.date <= end_date)
  )
  select coalesce(sum(amount) filter (where amount > 0), 0), coalesce(-sum(amount) filter (where amount < 0), 0) from r
$$;

-- An account's balance in the second currency at today's rate. Null when there is no second currency or no rate.
create or replace function public.second_balance(public.accounts) returns numeric
language sql stable set search_path = '' as $$
  select public.balance($1) * public.fx(coalesce($1.currency, public.home_currency()), public.second_currency(), current_date)
  where public.second_currency() is not null
$$;

revoke execute on function public.second_currency(), public.money_rows(date, date, text), public.money_total(date, date, text),
  public.txn_totals(text, uuid, uuid, text, date, date, text), public.second_balance(public.accounts) from public, anon;
grant execute on function public.second_currency(), public.money_rows(date, date, text), public.money_total(date, date, text),
  public.txn_totals(text, uuid, uuid, text, date, date, text), public.second_balance(public.accounts) to authenticated;
