import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";

let db: PGlite;
const admin = "00000000-0000-4000-8000-000000000001";
async function asAdmin() {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    admin,
  ]);
  await db.exec("set role authenticated");
}
async function rpc(name: string, args: unknown[] = []) {
  return (
    await db.query<{ value: any }>(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) value`,
      args,
    )
  ).rows[0].value;
}
async function entrants(count: number, heat = 1, category = "program") {
  await db.exec("reset role");
  const prefix =
    category === "program" ? "程" : category === "power" ? "動" : "機";
  await db.query(
    `insert into public.teams(team_number,name,category_id,heat)
    select $1||lpad(i::text,3,'0'),'王小明',$2,$3 from generate_series(1,$4::integer) i`,
    [prefix + String.fromCharCode(64 + heat), category, heat, count],
  );
  await db.query(
    `insert into public.attempts(team_id,category_id,slot_key,attempt_no,status,score_data)
    select id,category_id,'round-1',1,'valid',jsonb_build_object('completed',1,'seconds',5+right(team_number,3)::integer*0.5,'weight',100)
    from public.teams where category_id=$1 and heat=$2`,
    [category, heat],
  );
  await asAdmin();
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;",
  );
  await db.query("insert into auth.users values($1)", [admin]);
  const directory = new URL("../supabase/migrations/", import.meta.url);
  for (const file of readdirSync(directory)
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort())
    await db.exec(readFileSync(new URL(file, directory), "utf8"));
  await db.query(
    "insert into private.staff_roles(user_id,role,category_ids) values($1,'admin','{}')",
    [admin],
  );
}, 30000);
beforeEach(async () => {
  await db.exec(
    "reset role; update private.award_settings set publication_id=null where true; delete from private.award_publications where true; truncate public.teams,public.attempts,private.requests,private.audit_log cascade",
  );
  await asAdmin();
});
afterAll(async () => {
  await db?.close();
});

describe("自動前50%佳作（完整最新資料庫）", () => {
  it.each([
    [20, 7],
    [15, 5],
    [6, 0],
    [3, 0],
    [1, 0],
  ])("%i 人的佳作名額為 %i", async (count, merit) => {
    await entrants(count);
    const preview = await rpc("preview_awards", ["program", 1]);
    expect(preview).toMatchObject({
      quota: 3,
      merit_quota: merit,
      entrant_count: count,
      top_half_count: Math.ceil(count / 2),
      boundary_conflict: false,
    });
    expect(
      preview.entries.filter((e: any) => e.award_type === "merit"),
    ).toHaveLength(merit);
    expect(
      preview.entries.filter((e: any) => e.award_type === "rank"),
    ).toHaveLength(Math.min(count, 3));
    expect(preview.entries.map((e: any) => e.rank)).toEqual(
      Array.from({ length: Math.min(count, 3) + merit }, (_, i) => i + 1),
    );
  });
  it("分梯計算，未報到或未登分者仍計入名單基數；幼兒不提供排名", async () => {
    await entrants(15);
    await entrants(6, 2);
    await db.exec("reset role");
    await db.exec(
      "delete from public.attempts where team_id in(select id from public.teams where team_number='程A015')",
    );
    await asAdmin();
    const settings = await rpc("get_award_settings");
    expect(
      settings.find((s: any) => s.category_id === "program" && s.heat === 1),
    ).toMatchObject({ entrant_count: 15, merit_quota: 5 });
    expect(
      settings.find((s: any) => s.category_id === "program" && s.heat === 2),
    ).toMatchObject({ entrant_count: 6, merit_quota: 0 });
    await expect(rpc("preview_awards", ["preschool", 1])).rejects.toThrow(
      "不提供",
    );
  });
  it("舊版固定名額寫入被拒絕，匿名也不可預覽或修改", async () => {
    await expect(
      rpc("set_award_quotas", ["program", 1, 3, 50, 1]),
    ).rejects.toThrow("自動計算");
    await expect(rpc("set_award_quota", ["program", 1, 20, 1])).rejects.toThrow(
      "自動計算",
    );
    await db.exec("reset role; set role anon");
    await expect(rpc("preview_awards", ["program", 1])).rejects.toThrow();
    await expect(rpc("get_award_settings")).rejects.toThrow();
    await expect(
      rpc("set_award_quotas", ["program", 1, 3, 50, 1]),
    ).rejects.toThrow();
  });
  it("單梯公布保存計算後名額，名單變動後須重新預覽且不會自動更新已公布結果", async () => {
    await entrants(15);
    const p = await rpc("preview_awards", ["program", 1]);
    expect(await rpc("get_awards")).toEqual([]);
    const id = crypto.randomUUID();
    const args = ["program", 1, p.version, p.settings_revision, id];
    const saved = await rpc("publish_awards", args);
    expect(saved).toMatchObject({ quota: 3, merit_quota: 5 });
    expect(await rpc("publish_awards", args)).toEqual(saved);
    const published = await rpc("get_awards");
    expect(published).toHaveLength(8);
    const stale = await rpc("preview_awards", ["program", 1]);
    await db.exec("reset role");
    await db.exec(
      "insert into public.teams(team_number,name,category_id,heat) values('程A016','王小明','program',1),('程A017','王小明','program',1)",
    );
    await asAdmin();
    await expect(
      rpc("publish_awards", [
        "program",
        1,
        stale.version,
        stale.settings_revision,
        crypto.randomUUID(),
      ]),
    ).rejects.toThrow("重新預覽");
    expect(await rpc("get_awards")).toEqual(published);
    expect((await rpc("preview_awards", ["program", 1])).merit_quota).toBe(6);
  });
  it("全賽事公告保存各梯次動態名額，而非舊固定人數", async () => {
    await entrants(20);
    await entrants(15, 2);
    const p = await rpc("preview_all_awards");
    const saved = await rpc("publish_all_awards", [
      p.version,
      crypto.randomUUID(),
    ]);
    expect(
      saved.map((g: any) => [g.heat, g.quota, g.merit_quota, g.entries.length]),
    ).toEqual([
      [1, 3, 7, 10],
      [2, 3, 5, 8],
    ]);
  });
  it.each([3, 8])("同分跨越第 %i 名分界仍阻止公布", async (boundary) => {
    await entrants(15);
    await db.exec("reset role");
    await db.query(
      "update public.attempts set score_data=jsonb_set(score_data,'{seconds}',to_jsonb($1::numeric)) where team_id in(select id from public.teams where team_number=$2)",
      [5 + boundary * 0.5, `程A${String(boundary + 1).padStart(3, "0")}`],
    );
    await asAdmin();
    const p = await rpc("preview_awards", ["program", 1]);
    expect(p.boundary_conflict).toBe(true);
    await expect(
      rpc("publish_awards", [
        "program",
        1,
        p.version,
        p.settings_revision,
        crypto.randomUUID(),
      ]),
    ).rejects.toThrow("分界");
    const all = await rpc("preview_all_awards");
    await expect(
      rpc("publish_all_awards", [all.version, crypto.randomUUID()]),
    ).rejects.toThrow("分界");
  });
  it("25秒合格、舊26秒程式紀錄不列排名，動力30秒仍可儲存", async () => {
    await entrants(3);
    await db.exec("reset role");
    await db.exec(
      "update public.attempts set score_data=jsonb_set(score_data,'{seconds}',case when team_id=(select id from public.teams where team_number='程A001') then '25'::jsonb else '26'::jsonb end) where true",
    );
    const result = (
      await db.query<any>(
        "select primary_score,qualified,rank from public.results order by primary_score nulls last",
      )
    ).rows;
    expect(result[0]).toMatchObject({
      primary_score: "25",
      qualified: true,
      rank: 1,
    });
    expect(
      result
        .slice(1)
        .every(
          (r) => r.primary_score === null && r.rank === null && !r.qualified,
        ),
    ).toBe(true);
    await expect(
      db.query(
        "select private.normalize_score('power','valid','{\"bottles\":7,\"seconds\":30}'::jsonb)",
      ),
    ).resolves.toBeDefined();
  });
});
