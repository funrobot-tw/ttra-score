-- Both acknowledgements are required for each new score/revision, all groups.
-- Preserve existing scores, role checks, version checks and retry receipts.
begin;
do $migration$
declare definition text; updated text;
begin
 definition := pg_get_functiondef('private.submit_attempt(jsonb)'::regprocedure);
 updated := replace(definition,
  'if t.checkin_status<>''checked_in'' then',
  'if p_input->''confirmations''->''judge'' is distinct from ''true''::jsonb or p_input->''confirmations''->''participant'' is distinct from ''true''::jsonb then raise exception ''請裁判與選手雙方確認成績後再送出；舊版頁面請重新整理'';end if;
 if t.checkin_status<>''checked_in'' then');
 if updated=definition or position('請裁判與選手雙方確認成績後再送出' in definition)>0 then
  raise exception 'Unexpected submit confirmation definition';
 end if;
 definition := updated;
 updated := replace(definition,
  'case when old.id is null then null else to_jsonb(old) end,to_jsonb(saved));',
  'case when old.id is null then null else to_jsonb(old) end,to_jsonb(saved)||jsonb_build_object(''confirmations'',jsonb_build_object(''judge'',true,''participant'',true,''recorded_at'',saved.submitted_at,''method'',''two_button_confirmation'')));');
 if updated=definition then raise exception 'Unexpected score audit definition';end if;
 execute updated;
end;
$migration$;
commit;
