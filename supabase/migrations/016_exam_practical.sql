-- Add practical marking without changing existing grades or published snapshots.
begin;
alter table private.academic_candidates add column practical_completed boolean;
alter table public.academic_results add column practical_completed boolean;

create or replace function private.save_academic_score(p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.academic_candidates; saved private.academic_candidates; receipt private.requests;
 req uuid=(p_input->>'request_id')::uuid; expected integer=(p_input->>'expected_revision')::integer;
 reason text=btrim(coalesce(p_input->>'reason','')); value numeric; practical boolean;
 payload jsonb=p_input||'{"operation":"academic_score"}'::jsonb;
begin
 perform private.require_academic();
 if req is null or expected is null or expected<0 then raise exception '缺少送出識別碼或版本';end if;
 if p_input-array['id','score','practical_completed','reason','expected_revision','request_id'] <> '{}'::jsonb then raise exception '不接受額外欄位';end if;
 perform pg_advisory_xact_lock(hashtextextended(req::text,0));
 select * into receipt from private.requests where id=req;
 if receipt.id is not null then
  if receipt.actor_id<>auth.uid() or receipt.payload<>payload then raise exception '送出識別碼已用於其他內容';end if;
  return receipt.result;
 end if;
 perform 1 from private.academic_state where singleton = true for update;
 select * into c from private.academic_candidates where id=(p_input->>'id')::uuid for update;
 if c.id is null then raise exception '找不到檢定參賽者';end if;
 if expected<>c.revision then raise exception '成績已被更新，請重新載入後核對';end if;
 if ((c.score is not null or c.practical_completed is not null) and reason='') or length(reason)>1000 then raise exception '請填寫修改原因（最多 1000 字）';end if;
 if not (p_input ? 'score') then raise exception '缺少學科欄位';end if;
 if p_input->'score' = 'null'::jsonb then value=null;
 else value=round(private.num(p_input,'score',0,100),1);end if;
 -- Old clients omit this field: preserve the practical grade, never erase it.
 practical=c.practical_completed;
 if p_input ? 'practical_completed' then
  if jsonb_typeof(p_input->'practical_completed') not in ('boolean','null') then raise exception '術科狀態不正確';end if;
  practical=(p_input->>'practical_completed')::boolean;
 end if;
 if value is null and practical is null then raise exception '請至少登錄學科或術科成績';end if;
 if c.score is not null and value is null then raise exception '已登錄學科不可清空';end if;
 if c.practical_completed is not null and practical is null then raise exception '已登錄術科不可清空';end if;
 update private.academic_candidates set score=value,practical_completed=practical,revision=revision+1,updated_at=clock_timestamp() where id=c.id returning * into saved;
 insert into private.academic_audit(candidate_id,action,actor_id,reason,old_value,new_value)
 values(c.id,'score',auth.uid(),reason,to_jsonb(c),to_jsonb(saved));
 update private.academic_state set version=version+1 where singleton = true;
 insert into private.requests(id,actor_id,payload,result) values(req,auth.uid(),payload,to_jsonb(saved));
 return to_jsonb(saved);
end;$$;

do $upgrade$
declare definition text; updated text;
begin
 definition=pg_get_functiondef('private.get_academic_workspace()'::regprocedure);
 updated=replace(definition,'r.score published_score','r.score published_score,r.practical_completed published_practical_completed');
 if updated=definition then raise exception 'Unexpected academic workspace definition';end if;
 execute updated;
 definition=pg_get_functiondef('private.publish_academic(bigint,uuid)'::regprocedure);
 updated=replace(definition,'academic_results(id,number,name,score,published_at)','academic_results(id,number,name,score,practical_completed,published_at)');
 updated=replace(updated,'select id,number,name,score,stamp','select id,number,name,score,practical_completed,stamp');
 updated=replace(updated,'score=excluded.score,published_at=excluded.published_at','score=excluded.score,practical_completed=excluded.practical_completed,published_at=excluded.published_at');
 if updated=definition or position('practical_completed=excluded.practical_completed' in updated)=0 then raise exception 'Unexpected academic publication definition';end if;
 execute updated;
end;
$upgrade$;

create or replace function public.get_academic_results()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',p.version,'publishedAt',p.published_at,
 'results',coalesce((select jsonb_agg(jsonb_build_object(
 'id',r.id,'number',r.number,
 'name',case when char_length(btrim(r.name))<2 then btrim(r.name) else left(btrim(r.name),1)||'o'||substr(btrim(r.name),3) end,
 'passed',r.score>=80,'practical_completed',r.practical_completed,
 'overall_passed',case when r.practical_completed is null then null else r.score>=80 and r.practical_completed end,
 'published_at',r.published_at) order by r.number) from public.academic_results r),'[]'::jsonb))
 from public.academic_publication p where p.singleton = true
$$;
revoke all on public.academic_results from public,anon,authenticated;
revoke all on function public.get_academic_results() from public,anon,authenticated;
grant execute on function public.get_academic_results() to anon,authenticated;
-- Invalidate previews made before practical marking was introduced.
update private.academic_state set version=version+1 where singleton = true;
commit;
