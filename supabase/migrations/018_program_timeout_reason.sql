-- Program-only failure reason; no stored results or lock state changes.
begin;
do $migration$
declare definition text; updated text;
begin
 definition := pg_get_functiondef('private.normalize_score(text,text,jsonb)'::regprocedure);
 updated := replace(definition,
  'when c=''program'' then array[''超過邊界'',''車體鬆脫'',''飲料罐掉落'',''車體撞牆'']',
  'when c=''program'' then array[''超過邊界'',''車體鬆脫'',''飲料罐掉落'',''車體撞牆'',''超過時間'',''提早折返'']');
 if updated=definition then raise exception 'Unexpected failure reason validation';end if;
 execute updated;
end;
$migration$;
commit;
