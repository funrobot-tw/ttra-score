import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { it, expect } from "vitest";

it("雙確認前端可先部署：舊後端接受附加確認；後端升級不改舊成績及重送結果", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;",
    );
    const directory = new URL("../supabase/migrations/", import.meta.url);
    for (const file of readdirSync(directory)
      .filter((f) => /^\d+.*\.sql$/.test(f) && f < "015")
      .sort())
      await db.exec(readFileSync(new URL(file, directory), "utf8"));
    const admin = crypto.randomUUID(),
      entrant = crypto.randomUUID();
    await db.query("insert into auth.users values($1)", [admin]);
    await db.query(
      "insert into private.staff_roles(user_id,role,category_ids) values($1,'admin','{}')",
      [admin],
    );
    await db.query(
      "insert into public.teams(id,team_number,name,category_id,heat,checkin_status) values($1,'幼A001','王小明','preschool',1,'checked_in')",
      [entrant],
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      admin,
    ]);
    await db.exec("set role authenticated");
    const payload = {
      team_id: entrant,
      category_id: "preschool",
      slot_key: "round-1",
      status: "valid",
      reason: "",
      score_data: { childGoals: 2, parentGoals: 1 },
      expected_revision: 0,
      request_id: crypto.randomUUID(),
      confirmations: { judge: true, participant: true },
    };
    const send = async (value: object) =>
      (
        await db.query<any>("select public.submit_attempt($1::jsonb) result", [
          JSON.stringify(value),
        ])
      ).rows[0].result;
    const old = await send(payload);
    expect(old.score_data).toEqual({ childGoals: 2, parentGoals: 1 });
    await db.exec("reset role");
    await db.exec(
      readFileSync(
        new URL("015_dual_score_confirmation.sql", directory),
        "utf8",
      ),
    );
    await db.exec("set role authenticated");
    expect(await send(payload)).toEqual(old);
    const edit = {
      ...payload,
      expected_revision: 1,
      request_id: crypto.randomUUID(),
      reason: "重新核對",
      score_data: { childGoals: 3, parentGoals: 1 },
    };
    await expect(send({ ...edit, confirmations: undefined })).rejects.toThrow(
      "雙方確認",
    );
    expect((await send(edit)).revision).toBe(2);
  } finally {
    await db.close();
  }
}, 30000);
