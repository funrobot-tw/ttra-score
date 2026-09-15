-- Update validation without rewriting saved attempts or their audit history.
begin;
do $migration$
declare definition text; updated text;
begin
 definition := pg_get_functiondef('private.normalize_score(text,text,jsonb)'::regprocedure);
 updated := replace(definition,
  'array[''超過邊界'',''車體鬆脫'']',
  'array[''超過邊界'',''車體鬆脫'',''飲料罐掉落'']');
 if updated=definition then raise exception 'Unexpected failure reason validation';end if;
 definition := updated;
 updated := replace(definition,
  'case when c=''power'' then 30 else 40 end',
  'case when c=''power'' then 30 when c=''program'' then 25 else 40 end');
 if updated=definition then raise exception 'Unexpected time limit validation';end if;
 execute updated;
end;
$migration$;

-- Keep server rankings aligned with the client for previously stored rounds.
create or replace view public.results with (security_invoker=true) as
with raw as (
 select a.*,
  coalesce((score_data->>'seconds')::numeric,0) seconds,
  coalesce((score_data->>'weight')::numeric,0) weight,
  coalesce((score_data->>'bottles')::numeric,0) bottles,
  case category_id
   when 'preschool' then coalesce((score_data->>'childGoals')::numeric,0)+coalesce((score_data->>'parentGoals')::numeric,0)
   when 'creative' then coalesce((score_data->>'regular')::numeric,0)*10+case score_data->>'red' when 'correct' then 20 when 'wrong' then 5 else 0 end+case score_data->>'blue' when 'correct' then 20 when 'wrong' then 5 else 0 end
  end score
 from public.attempts a where status='valid'
 and (category_id<>'program' or ((score_data->>'completed')::numeric=1 and (score_data->>'seconds')::numeric<=25))
), best as (
 select distinct on(team_id) * from raw where category_id<>'power'
 order by team_id,case when category_id='program' then seconds else -score end,
 case when category_id='program' then weight else seconds end
), power_best as (
 select distinct on(team_id,split_part(slot_key,'-',1)) * from raw where category_id='power'
 order by team_id,split_part(slot_key,'-',1),bottles desc,seconds
), power_totals as (
 select team_id,
  case when count(*)=2 then sum(bottles) end primary_score,
  case when count(*)=2 then sum(seconds) end secondary_score,
  count(*)=2 and bool_or(bottles>=7) qualified
 from power_best group by team_id
), combined as (
 select t.id team_id,t.category_id,t.heat,
 case when t.category_id='power' then p.primary_score when t.category_id='program' then b.seconds else b.score end primary_score,
 case when t.category_id='power' then p.secondary_score when t.category_id='program' then b.weight when t.category_id='creative' then b.seconds end secondary_score,
 coalesce(case t.category_id when 'power' then p.qualified when 'preschool' then b.score>=3 when 'program' then b.seconds<=25 when 'creative' then b.score>=50 end,false) qualified,
 (select count(*) from public.attempts a where a.team_id=t.id)>=case when t.category_id='power' then 4 else 2 end complete
 from public.teams t left join best b on b.team_id=t.id left join power_totals p on p.team_id=t.id
)
select team_id,category_id,primary_score,secondary_score,qualified,complete,
 case when category_id='preschool' or primary_score is null then null else rank() over (
 partition by category_id,heat
 order by case when category_id='program' then primary_score else -primary_score end nulls last,secondary_score nulls last
 ) end rank
from combined;
update public.event_state set version=version+1 where singleton = true;
commit;
