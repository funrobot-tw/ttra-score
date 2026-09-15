-- Three ranked places; merit extends to ceil(all entrants in this heat / 2).
-- Publications remain immutable snapshots and require explicit staff approval.
begin;
create function private.award_limits(c text,h integer) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('quota',3,'merit_quota',greatest(0,((count(*)+1)/2)::integer-3),
  'entrant_count',count(*),'top_half_count',(count(*)+1)/2)
 from public.teams where category_id=c and heat=h
$$;
revoke all on function private.award_limits(text,integer) from public,anon,authenticated;

create or replace function public.get_award_settings() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.require_staff(array['admin']);
 select coalesce(jsonb_agg(jsonb_build_object('category_id',s.category_id,'heat',s.heat,
  'revision',s.revision,'published_at',p.published_at)||private.award_limits(s.category_id,s.heat)
  order by s.category_id,s.heat),'[]'::jsonb)
 into result from private.award_settings s left join private.award_publications p on p.id=s.publication_id;
 return result;
end;$$;

-- Reject stale clients rather than silently accepting fixed merit counts.
create or replace function public.set_award_quotas(p_category text,p_heat integer,p_quota integer,p_merit_quota integer,p_expected_revision integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.require_staff(array['admin']);
 raise exception '名額已改為前三名及前50%%自動計算，請重新整理工作台';
end;$$;

create or replace function public.preview_awards(p_category text,p_heat integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare setting private.award_settings; limits jsonb; entries jsonb; v bigint; ranked integer; merit integer; merit_limit integer;
begin
 perform private.require_staff(array['admin']);
 select * into setting from private.award_settings where category_id=p_category and heat=p_heat;
 if setting.category_id is null then raise exception '此項目或梯次不提供獎狀排名';end if;
 limits=private.award_limits(p_category,p_heat);
 merit_limit=(limits->>'merit_quota')::integer;
 select version into v from public.event_state where singleton = true;
 select coalesce(jsonb_agg(jsonb_build_object('team_id',t.id,'number',t.team_number,'name',t.name,'rank',r.rank,
  'award_type',case when r.rank<=3 then 'rank' else 'merit' end,
  'primary_score',r.primary_score,'secondary_score',r.secondary_score,'qualified',r.qualified,'complete',r.complete) order by r.rank,t.team_number),'[]'::jsonb),
  count(*) filter(where r.rank<=3),count(*) filter(where r.rank>3)
 into entries,ranked,merit from public.results r join public.teams t on t.id=r.team_id
 where t.category_id=p_category and t.heat=p_heat and r.rank<=3+merit_limit;
 return limits||jsonb_build_object('version',v,'settings_revision',setting.revision,
  'boundary_conflict',ranked>3 or merit>merit_limit,'entries',entries);
end;$$;

-- Single-heat publication already uses preview limits. Make the all-heat
-- publication snapshot use those same freshly computed limits as well.
do $migration$
declare definition text; updated text;
begin
 definition:=pg_get_functiondef('public.publish_all_awards(bigint,uuid)'::regprocedure);
 updated:=replace(definition,
  'values(gen_random_uuid(),old.category_id,old.heat,old.quota,old.merit_quota,g->''entries'',auth.uid())',
  'values(gen_random_uuid(),old.category_id,old.heat,(g->>''quota'')::integer,(g->>''merit_quota'')::integer,g->''entries'',auth.uid())');
 if updated=definition then raise exception 'Unexpected publication snapshot definition';end if;
 execute updated;
end;
$migration$;

-- Keep the old stored columns for historical compatibility. Live merit limits
-- are derived from the roster, never from these legacy fixed-count fields.
update private.award_settings set quota=3,merit_quota=0,revision=revision+1
where category_id in ('power','program','creative');
update public.event_state set version=version+1 where singleton = true;
commit;
