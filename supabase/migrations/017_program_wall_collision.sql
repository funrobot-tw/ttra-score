-- Program-only failure reason; preserve stored results and score lock triggers.
begin;
do $migration$
declare definition text; updated text;
begin
 definition := pg_get_functiondef('private.normalize_score(text,text,jsonb)'::regprocedure);
 updated := replace(definition,
  'when c in (''power'',''program'') then array[''超過邊界'',''車體鬆脫'',''飲料罐掉落'']',
  'when c=''power'' then array[''超過邊界'',''車體鬆脫'',''飲料罐掉落''] when c=''program'' then array[''超過邊界'',''車體鬆脫'',''飲料罐掉落'',''車體撞牆'']');
 if updated=definition then raise exception 'Unexpected failure reason validation';end if;
 execute updated;
end;
$migration$;
commit;
