import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { publicAcademicResult, AcademicDemoStore } from "../src/academic";
import { EventNavigation, EVENT_HOME } from "../src/EventNavigation";

it("四頁導覽使用統一按鈕，家長頁不暴露工作台", () => {
  for (const section of ["challenge", "exam"] as const)
    for (const staffView of [false, true]) {
      const html = renderToString(
        <EventNavigation section={section} staffView={staffView} />,
      );
      expect(html).toContain(EVENT_HOME);
      expect(html.match(/class="event-nav-button/g)).toHaveLength(
        staffView ? 3 : 2,
      );
      expect(html.includes("家長看成績")).toBe(staffView);
      expect(html).not.toContain("/staff");
    }
});

it("學科80分邊界與術科完成共同判定，缺術科不可推測為未通過", () => {
  for (const score of [0, 79.9, 80, 100])
    for (const practical of [null, false, true]) {
      const r = publicAcademicResult({
        id: "test",
        number: "機581115100401",
        name: "王小明",
        score,
        practical_completed: practical,
        published_at: "2026-10-04",
      });
      expect(r.overall_passed).toBe(
        practical === null ? null : score >= 80 && practical,
      );
      expect(r.name).toBe("王o明");
      expect(r).not.toHaveProperty("score");
    }
});

it("術科草稿、手動公布、舊客戶端、版本衝突與公開隱私", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;",
    );
    const directory = new URL("../supabase/migrations/", import.meta.url);
    for (const f of readdirSync(directory)
      .filter((f) => /^\d+.*\.sql$/.test(f) && f < "016")
      .sort())
      await db.exec(readFileSync(new URL(f, directory), "utf8"));
    const admin = crypto.randomUUID();
    await db.query("insert into auth.users values($1)", [admin]);
    await db.query(
      "insert into private.staff_roles(user_id,role,category_ids) values($1,'admin','{}')",
      [admin],
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      admin,
    ]);
    const rpc = async (name: string, args: unknown[] = []) =>
      (
        await db.query<any>(
          `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) r`,
          args,
        )
      ).rows[0].r;
    await db.exec("set role authenticated");
    await rpc("import_academic", [
      JSON.stringify([{ number: "機581115100401", name: "王小明" }]),
    ]);
    let ws = await rpc("get_academic_workspace");
    const id = ws.candidates[0].id;
    const old = {
      id,
      score: 80,
      reason: "",
      expected_revision: 0,
      request_id: crypto.randomUUID(),
    };
    await rpc("save_academic_score", [JSON.stringify(old)]);
    ws = await rpc("get_academic_workspace");
    await rpc("publish_academic", [ws.version, crypto.randomUUID()]);
    await db.exec("reset role");
    await db.exec(
      readFileSync(new URL("016_exam_practical.sql", directory), "utf8"),
    );
    await db.exec("set role authenticated");
    ws = await rpc("get_academic_workspace");
    expect(ws.candidates[0].score).toBe(80);
    expect(ws.candidates[0].practical_completed).toBeNull();
    expect(
      (await rpc("get_academic_results")).results[0].overall_passed,
    ).toBeNull();
    expect(
      (await rpc("save_academic_score", [JSON.stringify(old)])).revision,
    ).toBe(1);
    const input = {
      id,
      score: 80,
      practical_completed: true,
      reason: "術科核對",
      expected_revision: 1,
      request_id: crypto.randomUUID(),
    };
    const saved = await rpc("save_academic_score", [JSON.stringify(input)]);
    expect(saved.practical_completed).toBe(true);
    expect(await rpc("save_academic_score", [JSON.stringify(input)])).toEqual(
      saved,
    );
    await expect(
      rpc("publish_academic", [ws.version, crypto.randomUUID()]),
    ).rejects.toThrow("已更新");
    expect(
      (await rpc("get_academic_results")).results[0].overall_passed,
    ).toBeNull();
    ws = await rpc("get_academic_workspace");
    await rpc("publish_academic", [ws.version, crypto.randomUUID()]);
    const pub = (await rpc("get_academic_results")).results[0];
    expect(pub).toMatchObject({
      passed: true,
      practical_completed: true,
      overall_passed: true,
      name: "王o明",
    });
    expect(pub).not.toHaveProperty("score");
    const edit = {
      ...input,
      score: 79.9,
      expected_revision: 2,
      request_id: crypto.randomUUID(),
    };
    await expect(
      rpc("save_academic_score", [
        JSON.stringify({ ...edit, practical_completed: "true" }),
      ]),
    ).rejects.toThrow("術科狀態");
    await expect(
      rpc("save_academic_score", [JSON.stringify({ ...edit, reason: "" })]),
    ).rejects.toThrow("修改原因");
    await expect(
      rpc("save_academic_score", [
        JSON.stringify({ ...edit, expected_revision: 1 }),
      ]),
    ).rejects.toThrow("已被更新");
    // Legacy clients omit practical; keep it even when editing the academic grade.
    const { practical_completed: omitted, ...legacy } = edit;
    expect(
      (await rpc("save_academic_score", [JSON.stringify(legacy)]))
        .practical_completed,
    ).toBe(true);
    expect((await rpc("get_academic_results")).results[0].overall_passed).toBe(
      true,
    );
    ws = await rpc("get_academic_workspace");
    await rpc("publish_academic", [ws.version, crypto.randomUUID()]);
    expect((await rpc("get_academic_results")).results[0].overall_passed).toBe(
      false,
    );
    // Practical-only marking remains private until an academic score is available.
    await rpc("import_academic", [
      JSON.stringify([{ number: "機582115100401", name: "王小明" }]),
    ]);
    ws = await rpc("get_academic_workspace");
    const next = ws.candidates.find((c: any) => c.id !== id);
    expect(
      (
        await rpc("save_academic_score", [
          JSON.stringify({
            id: next.id,
            score: null,
            practical_completed: false,
            reason: "",
            expected_revision: 0,
            request_id: crypto.randomUUID(),
          }),
        ])
      ).practical_completed,
    ).toBe(false);
    await db.exec("reset role; set role anon");
    await expect(rpc("get_academic_workspace")).rejects.toThrow();
    await expect(
      rpc("save_academic_score", [JSON.stringify(input)]),
    ).rejects.toThrow();
    await expect(
      db.query("select * from public.academic_results"),
    ).rejects.toThrow();
    expect((await rpc("get_academic_results")).results).toHaveLength(1);
  } finally {
    await db.close();
  }
}, 30000);

it("隔離測試資料也保留未公布的術科變更", () => {
  const s = new AcademicDemoStore([
    { number: "機581115100401", name: "王小明" },
  ]);
  const c = s.readWorkspace().candidates[0];
  s.save({
    id: c.id,
    score: 80,
    practical_completed: false,
    reason: "",
    expected_revision: 0,
    request_id: "one",
  });
  expect(s.readPublic().results).toHaveLength(0);
  s.publish(s.readWorkspace().version, "pub");
  expect(s.readPublic().results[0].overall_passed).toBe(false);
});
