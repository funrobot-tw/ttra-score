-- Run as the project database administrator after migrations 009 and 010.
-- All synthetic entrants, attempts, claims and publication changes roll back.
begin;
do $$
declare staff_id uuid;
begin
 select user_id into staff_id from private.staff_roles where role='admin' order by user_id limit 1;
 if staff_id is null then raise exception 'No existing administrator for verification';end if;
 perform set_config('request.jwt.claim.sub',staff_id::text,true);
end;$$;
set local role authenticated;
do $verify$
declare roster_before jsonb; attempts_before jsonb; awards_before jsonb; settings_before jsonb; claims_before jsonb;
 entrant_number text; entrant_id uuid; slot text; saved jsonb; result_row public.results;
 setting jsonb; preview jsonb; publication jsonb; publication_id uuid=gen_random_uuid(); checked boolean=false;
begin
 select jsonb_agg(to_jsonb(t) order by id) into roster_before from public.teams t;
 select jsonb_agg(to_jsonb(a) order by id) into attempts_before from public.attempts a;
 awards_before=public.get_awards();settings_before=public.get_award_settings();claims_before=public.get_drink_claims();
 begin
  select '動A'||lpad(n::text,3,'0') into entrant_number from generate_series(999,1,-1) n
  where not exists(select 1 from public.teams where team_number='動A'||lpad(n::text,3,'0')) limit 1;
  if entrant_number is null then raise exception 'No unused synthetic entrant number';end if;
  perform public.import_teams(jsonb_build_array(jsonb_build_object('team_number',entrant_number,'name','王小明','category_id','power','heat',1)));
  select id into entrant_id from public.teams where team_number=entrant_number;
  perform public.set_checkin(entrant_id,'checked_in');
  foreach slot in array array['pull-1','pull-2','push-1','push-2'] loop
   saved=public.submit_attempt(jsonb_build_object('team_id',entrant_id,'category_id','power','slot_key',slot,'attempt_no',1,
    'status',case when slot like 'pull%' then 'invalid' else 'valid' end,'reason','回滾測試，不保留',
    'score_data',case when slot='pull-1' then '{"bottles":9,"seconds":71.5,"failureReason":"超過邊界"}'::jsonb
      when slot='pull-2' then '{"bottles":8,"failureReason":"車體鬆脫"}'::jsonb else '{"bottles":8,"seconds":20}'::jsonb end,
    'request_id',gen_random_uuid(),'expected_revision',0,'confirmations','{"judge":true,"participant":true}'::jsonb));
   if slot='pull-1' and saved->'score_data'->>'seconds' is distinct from '71.5' then raise exception 'Actual seconds not retained';end if;
   if slot='pull-2' and saved->'score_data' ? 'seconds' then raise exception 'Missing time was filled';end if;
  end loop;
  select * into result_row from public.results where team_id=entrant_id;
  if result_row.qualified or not result_row.complete or result_row.primary_score is not null or result_row.rank is not null then raise exception 'Missing-direction qualification regression';end if;
  saved=public.set_drink_claim(entrant_id,true,0);
  if saved->>'claimed' is distinct from 'true' then raise exception 'Claim not saved';end if;
  if public.set_drink_claim(entrant_id,true,0)<>saved then raise exception 'Claim retry not idempotent';end if;
  saved=public.set_drink_claim(entrant_id,false,1);
  if saved->>'claimed' is distinct from 'false' or saved->>'revision' is distinct from '2' then raise exception 'Claim correction failed';end if;
  -- Give only the synthetic entrant a valid pull, so a preview always exists.
  perform public.submit_attempt(jsonb_build_object('team_id',entrant_id,'category_id','power','slot_key','pull-1','attempt_no',1,
   'status','valid','reason','回滾測試更正，不保留','score_data','{"bottles":7,"seconds":20}'::jsonb,'request_id',gen_random_uuid(),'expected_revision',1,'confirmations','{"judge":true,"participant":true}'::jsonb));
  select value into setting from jsonb_array_elements(public.get_award_settings()) where value->>'category_id'='power' and value->>'heat'='1';
  perform public.set_award_quota('power',1,500,(setting->>'revision')::integer);
  preview=public.preview_awards('power',1);
  publication=public.publish_awards('power',1,(preview->>'version')::bigint,(preview->>'settings_revision')::integer,publication_id);
  if public.publish_awards('power',1,(preview->>'version')::bigint,(preview->>'settings_revision')::integer,publication_id)<>publication then raise exception 'Publication retry not idempotent';end if;
  if not exists(select 1 from jsonb_array_elements(public.get_awards()) where value->>'team_id'=entrant_id::text) then raise exception 'Published rank absent';end if;
  if exists(select 1 from jsonb_array_elements(public.get_awards()) where value ? 'name') then raise exception 'Public award names leaked';end if;
  checked=true;
  raise exception 'ROLLBACK_SYNTHETIC_CHECK' using errcode='ZX001';
 exception when sqlstate 'ZX001' then null;
 end;
 if not checked then raise exception 'Verification did not complete';end if;
 if (select jsonb_agg(to_jsonb(t) order by id) from public.teams t) is distinct from roster_before
 or (select jsonb_agg(to_jsonb(a) order by id) from public.attempts a) is distinct from attempts_before
 or public.get_awards() is distinct from awards_before or public.get_award_settings() is distinct from settings_before
 or public.get_drink_claims() is distinct from claims_before then raise exception 'Rollback verification failed';end if;
end;$verify$;
select 'PASS: scoring, drinks, award publication, and complete rollback' as verification,
 (select count(*) from public.teams) as retained_entrants,
 (select count(*) from public.attempts) as retained_attempts,
 (select md5(jsonb_agg(to_jsonb(t) order by id)::text) from public.teams t) as roster_digest,
 (select md5(jsonb_agg(to_jsonb(a) order by id)::text) from public.attempts a) as attempts_digest;
rollback;
