import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { leaderboard, type Team, type Attempt } from "../src/domain";
import { demoTeams } from "../src/demo";
let db: PGlite;
const admin = "00000000-0000-4000-8000-000000000001",
  judge = "00000000-0000-4000-8000-000000000002",
  checkin = "00000000-0000-4000-8000-000000000003",
  outsider = "00000000-0000-4000-8000-000000000004",
  examiner = "00000000-0000-4000-8000-000000000005";
async function asUser(id: string | null, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id ?? "",
  ]);
  await db.exec("set role " + role);
}
const prefixes: Record<string, string> = {
  preschool: "幼",
  power: "動",
  program: "程",
  creative: "機",
};
async function createTeam(category = "power", number?: string, heat = 1) {
  number ??= prefixes[category] + String.fromCharCode(64 + heat) + "001";
  await asUser(admin);
  await db.query("select public.import_teams($1)", [
    JSON.stringify([
      {
        team_number: number,
        name: "陳宥安",
        heat,
        category_id: category,
      },
    ]),
  ]);
  const { rows } = await db.query<{ id: string }>(
    "select id from public.teams where team_number=$1",
    [number],
  );
  await db.query("select public.set_checkin($1,'checked_in')", [rows[0].id]);
  return rows[0].id;
}
function input(
  team_id: string,
  category_id = "power",
  slot_key = "pull-1",
  score_data: Record<string, unknown> = { bottles: 7, seconds: 20 },
) {
  return {
    team_id,
    category_id,
    slot_key,
    attempt_no: 1,
    status: "valid",
    reason: "",
    score_data,
    request_id: crypto.randomUUID(),
    expected_revision: 0,
    confirmations: { judge: true, participant: true },
  };
}
async function submit(p: ReturnType<typeof input>) {
  const { rows } = await db.query<{ result: any }>(
    "select public.submit_attempt($1) result",
    [JSON.stringify(p)],
  );
  return rows[0].result;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;",
  );
  for (const id of [admin, judge, checkin, outsider, examiner])
    await db.query("insert into auth.users values($1)", [id]);
  await db.exec(
    readFileSync(
      new URL("../supabase/migrations/001_competition.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.query(
    "insert into private.staff_roles(user_id,role,category_ids) values($1,'admin','{}'),($2,'judge','{power}'),($3,'checkin','{}')",
    [admin, judge, checkin],
  );
  for (const migration of [
    "002_heats_and_privacy.sql",
    "003_academic.sql",
    "004_participant_numbering.sql",
    "005_heat_numbering.sql",
    "006_rank_by_heat.sql",
    "007_checkin_time_and_public_names.sql",
    "008_academic_safe_updates.sql",
    "009_challenge_attempt_rules.sql",
    "010_rewards_and_award_publication.sql",
    "011_rank_and_merit_awards.sql",
    "012_academic_public_privacy.sql",
    "013_program_time_and_failure_reasons.sql",
    "015_dual_score_confirmation.sql",
  ])
    await db.exec(
      readFileSync(
        new URL("../supabase/migrations/" + migration, import.meta.url),
        "utf8",
      ),
    );
  await db.query(
    "insert into private.staff_roles(user_id,role,can_grade_academic) values($1,'judge',true)",
    [examiner],
  );
}, 30000);
beforeEach(async () => {
  await db.exec(
    "reset role; update private.award_settings set quota=null,merit_quota=0,revision=0,publication_id=null where true; delete from private.award_publications where true; truncate public.teams,public.attempts,private.audit_log,private.requests,private.academic_candidates,private.academic_audit,public.academic_results cascade; update private.academic_state set version=0; update public.academic_publication set version=0,published_at=null",
  );
});
async function academicSetup() {
  await asUser(admin);
  await db.query("select public.import_academic($1)", [
    JSON.stringify([
      { number: "E001", name: "陳宥安" },
      { number: "E002", name: "林芷晴" },
      { number: "E003", name: "張語彤" },
    ]),
  ]);
  return academicWorkspace();
}
async function rpcResult(name: string, args: unknown[] = []) {
  return (
    await db.query<{ value: any }>(
      `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) value`,
      args,
    )
  ).rows[0].value;
}
describe("四組送分均需雙方確認", () => {
  it.each(["preschool", "power", "program", "creative"])(
    "%s 缺一確認不儲存；雙方確認後保留紀錄並可安全重試",
    async (category) => {
      const id = await createTeam(category);
      const slot =
        category === "power"
          ? "pull-1"
          : category === "creative"
            ? "left"
            : "round-1";
      const data =
        category === "preschool"
          ? { childGoals: 2, parentGoals: 1 }
          : category === "power"
            ? { bottles: 7, seconds: 30 }
            : category === "program"
              ? { completed: 1, seconds: 25, weight: 300 }
              : { regular: 5, red: "none", blue: "none", seconds: 40 };
      const p = input(id, category, slot, data);
      for (const confirmations of [
        undefined,
        null,
        {},
        { judge: true },
        { participant: true },
        { judge: "true", participant: true },
        { judge: true, participant: false },
      ]) {
        await expect(
          submit({ ...p, confirmations: confirmations as any }),
        ).rejects.toThrow("雙方確認");
      }
      expect(
        (await db.query("select * from public.attempts where team_id=$1", [id]))
          .rows,
      ).toHaveLength(0);
      const saved = await submit(p);
      expect(saved.revision).toBe(1);
      expect(await submit(p)).toEqual(saved);
      const audit = (await rpcResult("read_audit")).filter(
        (row: any) => row.action === "score_create",
      );
      expect(audit).toHaveLength(1);
      expect(audit[0].new_value.confirmations).toEqual({
        judge: true,
        participant: true,
        method: "two_button_confirmation",
        recorded_at: saved.submitted_at,
      });
      await expect(
        submit({
          ...p,
          expected_revision: 1,
          request_id: crypto.randomUUID(),
          reason: "更正",
          confirmations: { judge: true, participant: false },
        }),
      ).rejects.toThrow("雙方確認");
      const edited = await submit({
        ...p,
        expected_revision: 1,
        request_id: crypto.randomUUID(),
        reason: "再次核對後更正",
      });
      expect(edited.revision).toBe(2);
      expect(
        (await rpcResult("read_audit")).filter(
          (row: any) => row.action === "score_update",
        )[0].new_value.confirmations.participant,
      ).toBe(true);
    },
  );
  it("未完成回合也不能略過選手確認", async () => {
    const id = await createTeam();
    const p = {
      ...input(id),
      status: "invalid",
      reason: "飲料罐掉落",
      score_data: { bottles: 2, failureReason: "飲料罐掉落" },
    };
    await expect(
      submit({ ...p, confirmations: { judge: true, participant: false } }),
    ).rejects.toThrow("雙方確認");
    expect((await submit(p)).status).toBe("invalid");
  });
});
describe("名次名額與佳作名額", () => {
  async function entrants(times = [10, 11, 12, 13, 14, 15]) {
    const ids: string[] = [];
    for (const [i, seconds] of times.entries()) {
      const id = await createTeam(
        "program",
        `程A${String(i + 1).padStart(3, "0")}`,
      );
      ids.push(id);
      await submit(
        input(id, "program", "round-1", { completed: 1, seconds, weight: 300 }),
      );
    }
    return ids;
  }
  const publish = (p: any) =>
    rpcResult("publish_awards", [
      "program",
      1,
      p.version,
      p.settings_revision,
      crypto.randomUUID(),
    ]);

  it("前三名加兩位佳作；公開不含佳作順位，未得獎者不公開名次", async () => {
    const ids = await entrants();
    await rpcResult("set_award_quotas", ["program", 1, 3, 2, 0]);
    expect(await rpcResult("get_awards")).toEqual([]);
    const p = await rpcResult("preview_awards", ["program", 1]);
    expect(p).toMatchObject({
      quota: 3,
      merit_quota: 2,
      boundary_conflict: false,
    });
    expect(p.entries.map((e: any) => e.award_type)).toEqual([
      "rank",
      "rank",
      "rank",
      "merit",
      "merit",
    ]);
    const saved = await publish(p);
    expect(saved.merit_quota).toBe(2);
    await asUser(null, "anon");
    const awards = await rpcResult("get_awards");
    expect(awards.map((a: any) => a.rank)).toEqual([1, 2, 3, null, null]);
    expect(
      awards
        .filter((a: any) => a.award_type === "merit")
        .map((a: any) => a.team_id),
    ).toEqual(ids.slice(3, 5));
    expect(awards.some((a: any) => a.team_id === ids[5])).toBe(false);
    expect(
      (await rpcResult("get_scoreboard")).results.every(
        (r: any) => r.rank === null,
      ),
    ).toBe(true);
    await asUser(admin);
    await submit(
      input(ids[5], "program", "round-2", {
        completed: 1,
        seconds: 5,
        weight: 300,
      }),
    );
    await rpcResult("set_award_quotas", ["program", 1, 2, 3, 1]);
    expect(await rpcResult("get_awards")).toEqual(awards);
  });
  it("同分跨越名次與佳作分界時，即使總人數符合也不能公布", async () => {
    await entrants([10, 11, 12, 12, 14]);
    await rpcResult("set_award_quotas", ["program", 1, 3, 2, 0]);
    const p = await rpcResult("preview_awards", ["program", 1]);
    expect(p.entries).toHaveLength(5);
    expect(p.boundary_conflict).toBe(true);
    await expect(publish(p)).rejects.toThrow("同名次");
    const all = await rpcResult("preview_all_awards");
    await expect(
      rpcResult("publish_all_awards", [all.version, crypto.randomUUID()]),
    ).rejects.toThrow("同名次");
    expect(await rpcResult("get_awards")).toEqual([]);
  });
  it("同分超過佳作尾端名額不能公布；佳作人數不足不補入無成績者", async () => {
    await entrants([10, 11, 12, 12]);
    await createTeam("program", "程A005");
    await rpcResult("set_award_quotas", ["program", 1, 1, 2, 0]);
    const p = await rpcResult("preview_awards", ["program", 1]);
    expect(p.boundary_conflict).toBe(true);
    await expect(publish(p)).rejects.toThrow("同名次");
    await rpcResult("set_award_quotas", ["program", 1, 1, 5, 1]);
    const allowed = await rpcResult("preview_awards", ["program", 1]);
    expect(allowed.entries).toHaveLength(4);
    expect(allowed.boundary_conflict).toBe(false);
    await publish(allowed);
  });
  it("可只設佳作，統一公告保持分梯次與重試安全", async () => {
    await entrants([10, 11]);
    const other = await createTeam("program", "程B001", 2);
    await submit(
      input(other, "program", "round-1", {
        completed: 1,
        seconds: 8,
        weight: 300,
      }),
    );
    await rpcResult("set_award_quotas", ["program", 1, 0, 2, 0]);
    await rpcResult("set_award_quotas", ["program", 2, 1, 0, 0]);
    const p = await rpcResult("preview_all_awards");
    const args = [p.version, crypto.randomUUID()];
    const saved = await rpcResult("publish_all_awards", args);
    expect(saved.map((s: any) => s.merit_quota)).toEqual([2, 0]);
    expect(await rpcResult("publish_all_awards", args)).toEqual(saved);
    const awards = await rpcResult("get_awards");
    expect(
      awards
        .filter((a: any) => a.heat === 1)
        .every((a: any) => a.rank === null && a.award_type === "merit"),
    ).toBe(true);
    expect(awards.find((a: any) => a.team_id === other)).toMatchObject({
      rank: 1,
      award_type: "rank",
    });
  });
  it("新名額接口保留權限、版本及合法範圍檢查，舊接口不抹除佳作", async () => {
    await asUser(admin);
    for (const pair of [
      [null, 2],
      [2, null],
      [-1, 2],
      [0, 0],
      [300, 300],
    ])
      await expect(
        rpcResult("set_award_quotas", ["program", 1, ...pair, 0]),
      ).rejects.toThrow("名額");
    await rpcResult("set_award_quotas", ["program", 1, 3, 2, 0]);
    await expect(
      rpcResult("set_award_quotas", ["program", 1, 3, 3, 0]),
    ).rejects.toThrow("已更新");
    await rpcResult("set_award_quota", ["program", 1, 4, 1]);
    expect(
      (await rpcResult("get_award_settings")).find(
        (s: any) => s.category_id === "program" && s.heat === 1,
      ),
    ).toMatchObject({ quota: 4, merit_quota: 2 });
    for (const id of [judge, checkin, outsider]) {
      await asUser(id);
      await expect(
        rpcResult("set_award_quotas", ["program", 1, 3, 2, 2]),
      ).rejects.toThrow("權限");
    }
  });
});

describe("挑戰賽新版規則、飲料與公告", () => {
  it("正式回滾驗證腳本可執行且不保留測試資料", async () => {
    await db.exec("reset role");
    await db.exec(
      readFileSync(
        new URL("../supabase/verify_challenge_upgrade.sql", import.meta.url),
        "utf8",
      ),
    );
    expect((await db.query("select * from public.teams")).rows).toHaveLength(0);
    expect(
      (await db.query("select * from private.drink_claims")).rows,
    ).toHaveLength(0);
    expect(
      (await db.query("select * from private.award_publications")).rows,
    ).toHaveLength(0);
  });
  it("全賽事名次可一次公告，重送不重複且不同梯次同時生效", async () => {
    const one = await createTeam("program", "程A001"),
      two = await createTeam("creative", "機B001", 2);
    await submit(
      input(one, "program", "round-1", {
        completed: 1,
        seconds: 15,
        weight: 300,
      }),
    );
    await submit(
      input(two, "creative", "left", {
        regular: 8,
        red: "none",
        blue: "none",
        seconds: 30,
      }),
    );
    await expect(rpcResult("preview_all_awards")).rejects.toThrow("名額");
    await rpcResult("set_award_quota", ["program", 1, 1, 0]);
    await rpcResult("set_award_quota", ["creative", 2, 1, 0]);
    const preview = await rpcResult("preview_all_awards");
    expect(preview.groups).toHaveLength(2);
    const args = [preview.version, crypto.randomUUID()];
    const saved = await rpcResult("publish_all_awards", args);
    expect(saved).toHaveLength(2);
    expect(await rpcResult("publish_all_awards", args)).toEqual(saved);
    expect(await rpcResult("get_awards")).toHaveLength(2);
    await asUser(judge);
    await expect(rpcResult("preview_all_awards")).rejects.toThrow("權限");
    await expect(rpcResult("publish_all_awards", args)).rejects.toThrow("權限");
  });
  it("統一公告有空梯或超額同名次時整批不發布，過期預覽被拒絕", async () => {
    const one = await createTeam("program", "程A001"),
      two = await createTeam("program", "程B001", 2);
    await submit(
      input(one, "program", "round-1", {
        completed: 1,
        seconds: 15,
        weight: 300,
      }),
    );
    await rpcResult("set_award_quota", ["program", 1, 1, 0]);
    await rpcResult("set_award_quota", ["program", 2, 1, 0]);
    const preview = await rpcResult("preview_all_awards");
    await expect(
      rpcResult("publish_all_awards", [preview.version, crypto.randomUUID()]),
    ).rejects.toThrow("尚無");
    expect(await rpcResult("get_awards")).toEqual([]);
    await submit(
      input(two, "program", "round-1", {
        completed: 1,
        seconds: 15,
        weight: 300,
      }),
    );
    await expect(
      rpcResult("publish_all_awards", [preview.version, crypto.randomUUID()]),
    ).rejects.toThrow("已更新");
    const third = await createTeam("program", "程B002", 2);
    await submit(
      input(third, "program", "round-1", {
        completed: 1,
        seconds: 15,
        weight: 300,
      }),
    );
    const tied = await rpcResult("preview_all_awards");
    await expect(
      rpcResult("publish_all_awards", [tied.version, crypto.randomUUID()]),
    ).rejects.toThrow("同名次");
    expect(await rpcResult("get_awards")).toEqual([]);
  });
  it("未完成保留瓶數及超時實際秒數，不能取得有效合計或合格", async () => {
    const id = await createTeam();
    for (const slot of ["pull-1", "pull-2"])
      await submit({
        ...input(id, "power", slot, {
          bottles: 9,
          seconds: 60.5,
          failureReason: "超過邊界",
        }),
        status: "invalid",
        reason: "超過邊界",
      });
    for (const slot of ["push-1", "push-2"])
      await submit(input(id, "power", slot, { bottles: 8, seconds: 20 }));
    const board = await rpcResult("get_scoreboard");
    expect(board.results[0]).toMatchObject({
      primary_score: null,
      secondary_score: null,
      qualified: false,
      complete: true,
      rank: null,
    });
    expect(
      board.attempts.find((a: any) => a.slot_key === "pull-1").score_data,
    ).toEqual({ bottles: 9, seconds: 60.5, failureReason: "超過邊界" });
  });
  it("三組未完成可不計時，保留其他數據且拒絕錯誤原因與負秒數", async () => {
    for (const [category, slot, data] of [
      ["power", "pull-1", { bottles: 8, failureReason: "車體鬆脫" }],
      ["program", "round-1", { weight: 300, failureReason: "超過邊界" }],
      [
        "creative",
        "left",
        { regular: 4, red: "correct", blue: "none", failureReason: "翻覆" },
      ],
    ] as const) {
      const id = await createTeam(category);
      const p = {
        ...input(id, category, slot, data),
        status: "invalid",
        reason: "未完成",
      };
      const saved = await submit(p);
      expect(saved.score_data).toMatchObject(data);
      expect(saved.score_data).not.toHaveProperty("seconds");
      for (const patch of [{ seconds: -1 }, { failureReason: "任意原因" }])
        await expect(
          submit({
            ...p,
            request_id: crypto.randomUUID(),
            expected_revision: 1,
            score_data: { ...data, ...patch },
          }),
        ).rejects.toThrow();
    }
  });
  it("程式上限 25 秒，新增掉罐原因且未完成秒數不受限", async () => {
    const normalize = async (category: string, status: string, data: object) =>
      (
        await db.query<{ value: Record<string, unknown> }>(
          "select private.normalize_score($1,$2,$3::jsonb) value",
          [category, status, JSON.stringify(data)],
        )
      ).rows[0].value;
    expect(
      await normalize("program", "valid", {
        completed: 1,
        weight: 100,
        seconds: 25,
      }),
    ).toMatchObject({ seconds: 25 });
    await expect(
      normalize("program", "valid", {
        completed: 1,
        weight: 100,
        seconds: 25.1,
      }),
    ).rejects.toThrow();
    for (const category of ["power", "program"]) {
      const data = { bottles: 2, weight: 100, failureReason: "飲料罐掉落" };
      expect(await normalize(category, "invalid", data)).not.toHaveProperty(
        "seconds",
      );
      expect(
        await normalize(category, "invalid", { ...data, seconds: 60 }),
      ).toMatchObject({ seconds: 60, failureReason: "飲料罐掉落" });
    }
    await expect(
      normalize("creative", "invalid", {
        regular: 2,
        red: "none",
        blue: "none",
        failureReason: "飲料罐掉落",
      }),
    ).rejects.toThrow();
    expect(
      await normalize("creative", "valid", {
        regular: 2,
        red: "none",
        blue: "none",
        seconds: 40,
      }),
    ).toMatchObject({ seconds: 40 });
    expect(
      await normalize("power", "valid", { bottles: 2, seconds: 30 }),
    ).toMatchObject({ seconds: 30 });
  });
  it("幼兒無未完成、科創無提前終止；正常回合仍須遵守時限", async () => {
    const child = await createTeam("preschool");
    await expect(
      submit({
        ...input(child, "preschool", "round-1", {
          childGoals: 0,
          parentGoals: 0,
        }),
        status: "invalid",
        reason: "未完成",
      }),
    ).rejects.toThrow("幼兒");
    const id = await createTeam("creative");
    await expect(
      submit({
        ...input(id, "creative", "left", {
          regular: 4,
          red: "none",
          blue: "none",
          seconds: 5,
        }),
        status: "terminated",
        reason: "翻覆",
      }),
    ).rejects.toThrow("提前終止");
  });
  it("飲料只限有權限工作人員，跨組與匿名讀寫被拒絕", async () => {
    const power = await createTeam(),
      creative = await createTeam("creative");
    await rpcResult("set_drink_claim", [creative, true, 0]);
    await asUser(judge);
    await rpcResult("set_drink_claim", [power, true, 0]);
    expect(await rpcResult("get_drink_claims")).toHaveLength(1);
    await expect(
      rpcResult("set_drink_claim", [creative, false, 1]),
    ).rejects.toThrow("組別");
    await asUser(outsider);
    await expect(rpcResult("get_drink_claims")).rejects.toThrow("權限");
    await asUser(null, "anon");
    await expect(rpcResult("get_drink_claims")).rejects.toThrow();
    await expect(
      rpcResult("set_drink_claim", [power, false, 1]),
    ).rejects.toThrow();
    expect(await rpcResult("get_scoreboard")).not.toHaveProperty(
      "drink_claims",
    );
  });
  it("領取勾選重送不重複稽核、舊版本無法覆蓋，取消誤勾有紀錄", async () => {
    const id = await createTeam();
    const first = await rpcResult("set_drink_claim", [id, true, 0]);
    expect(first).toMatchObject({ claimed: true, revision: 1 });
    expect(await rpcResult("set_drink_claim", [id, true, 0])).toEqual(first);
    await expect(rpcResult("set_drink_claim", [id, false, 0])).rejects.toThrow(
      "更新",
    );
    expect(await rpcResult("set_drink_claim", [id, false, 1])).toMatchObject({
      claimed: false,
      revision: 2,
      claimed_at: null,
    });
    expect(
      (await rpcResult("read_audit")).filter(
        (a: any) => a.action === "drink_claim_update",
      ),
    ).toHaveLength(2);
  });
  it("公告名額預設空白、僅管理員可設定與預覽，幼兒不得設名額", async () => {
    await asUser(admin);
    expect(await rpcResult("get_award_settings")).toHaveLength(7);
    expect(
      (await rpcResult("get_award_settings")).every(
        (s: any) => s.quota === null && s.published_at === null,
      ),
    ).toBe(true);
    await expect(rpcResult("preview_awards", ["power", 1])).rejects.toThrow(
      "名額",
    );
    await expect(
      rpcResult("set_award_quota", ["preschool", 1, 3, 0]),
    ).rejects.toThrow("不提供");
    for (const id of [judge, checkin, outsider]) {
      await asUser(id);
      await expect(rpcResult("get_award_settings")).rejects.toThrow("權限");
      await expect(
        rpcResult("set_award_quota", ["power", 1, 3, 0]),
      ).rejects.toThrow("權限");
      await expect(rpcResult("preview_awards", ["power", 1])).rejects.toThrow(
        "權限",
      );
    }
  });
  it("公開即時分數而不公開暫定排名，公布只含本梯名額內名次且不含全名", async () => {
    const first = await createTeam("program", "程A001"),
      second = await createTeam("program", "程A002"),
      otherHeat = await createTeam("program", "程B001", 2);
    for (const [id, seconds] of [
      [first, 15],
      [second, 20],
      [otherHeat, 10],
    ] as const)
      await submit(
        input(id, "program", "round-1", { completed: 1, seconds, weight: 300 }),
      );
    await asUser(null, "anon");
    const before = await rpcResult("get_scoreboard");
    expect(before.results.every((r: any) => r.rank === null)).toBe(true);
    expect(
      before.results.find((r: any) => r.team_id === first).primary_score,
    ).toBe(15);
    expect(before.awards).toEqual([]);
    await asUser(admin);
    await rpcResult("set_award_quota", ["program", 1, 1, 0]);
    const preview = await rpcResult("preview_awards", ["program", 1]);
    const args = [
      "program",
      1,
      preview.version,
      preview.settings_revision,
      crypto.randomUUID(),
    ];
    const published = await rpcResult("publish_awards", args);
    expect(await rpcResult("publish_awards", args)).toEqual(published);
    await asUser(null, "anon");
    const awards = await rpcResult("get_awards");
    expect(awards).toHaveLength(1);
    expect(awards[0]).toMatchObject({ team_id: first, rank: 1, heat: 1 });
    expect(awards[0]).not.toHaveProperty("name");
    expect(JSON.stringify(await rpcResult("get_scoreboard"))).not.toContain(
      "陳宥安",
    );
    await asUser(admin);
    await submit(
      input(second, "program", "round-2", {
        completed: 1,
        seconds: 12,
        weight: 300,
      }),
    );
    expect(await rpcResult("get_awards")).toEqual(awards);
  });
  it("過期預覽、超額同名次及空名單不能公布", async () => {
    const first = await createTeam("program", "程A001");
    await rpcResult("set_award_quota", ["program", 1, 1, 0]);
    const empty = await rpcResult("preview_awards", ["program", 1]);
    await expect(
      rpcResult("publish_awards", [
        "program",
        1,
        empty.version,
        empty.settings_revision,
        crypto.randomUUID(),
      ]),
    ).rejects.toThrow("尚無");
    await submit(
      input(first, "program", "round-1", {
        completed: 1,
        seconds: 15,
        weight: 300,
      }),
    );
    const stale = await rpcResult("preview_awards", ["program", 1]);
    const second = await createTeam("program", "程A002");
    await submit(
      input(second, "program", "round-1", {
        completed: 1,
        seconds: 15,
        weight: 300,
      }),
    );
    await expect(
      rpcResult("publish_awards", [
        "program",
        1,
        stale.version,
        stale.settings_revision,
        crypto.randomUUID(),
      ]),
    ).rejects.toThrow("已更新");
    const tied = await rpcResult("preview_awards", ["program", 1]);
    expect(tied.entries).toHaveLength(2);
    await expect(
      rpcResult("publish_awards", [
        "program",
        1,
        tied.version,
        tied.settings_revision,
        crypto.randomUUID(),
      ]),
    ).rejects.toThrow("同名次");
    expect(await rpcResult("get_awards")).toEqual([]);
  });
});
async function academicWorkspace(): Promise<any> {
  return (
    await db.query<{ value: any }>(
      "select public.get_academic_workspace() value",
    )
  ).rows[0].value;
}
async function academicPublic(): Promise<any> {
  return (
    await db.query<{ value: any }>("select public.get_academic_results() value")
  ).rows[0].value;
}
async function academicSave(
  c: any,
  score: unknown,
  requestId = crypto.randomUUID(),
) {
  const input = {
    id: c.id,
    score,
    expected_revision: c.revision,
    reason: c.score !== null ? "複核" : "",
    request_id: requestId,
  };
  return (
    await db.query<{ value: any }>(
      "select public.save_academic_score($1) value",
      [JSON.stringify(input)],
    )
  ).rows[0].value;
}
describe("學科私有登分與公開快照資料庫", () => {
  it("匯入、登分及公布的版本更新都指定單例資料列", async () => {
    // PGlite does not load production's safe-update module, so check the
    // installed routines as well as the functional transaction tests below.
    const { rows } = await db.query<{ definition: string }>(
      "select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('import_academic','save_academic_score','publish_academic')",
    );
    expect(rows).toHaveLength(3);
    const updates = rows.flatMap(
      ({ definition }) =>
        definition.match(
          /update\s+(?:private\.academic_state|public\.academic_publication)\s+set\b[^;]*;/gi,
        ) ?? [],
    );
    expect(updates).toHaveLength(4);
    for (const update of updates)
      expect(update).toMatch(/\bwhere\s+singleton\s*=\s*true\s*;/i);
  });
  it("只有管理員及獲授權學科評審能讀寫草稿", async () => {
    const w = await academicSetup();
    for (const id of [judge, checkin, outsider]) {
      await asUser(id);
      await expect(academicWorkspace()).rejects.toThrow("學科成績操作權限");
      await expect(academicSave(w.candidates[0], 90)).rejects.toThrow(
        "學科成績操作權限",
      );
      await expect(
        db.query("select public.publish_academic(0,$1)", [crypto.randomUUID()]),
      ).rejects.toThrow("學科成績操作權限");
    }
    await asUser(examiner);
    expect((await academicWorkspace()).candidates).toHaveLength(3);
    await academicSave(w.candidates[0], 90);
    await expect(
      db.query("select public.import_academic('[]')"),
    ).rejects.toThrow("操作權限");
    await asUser(null, "anon");
    await expect(academicWorkspace()).rejects.toThrow("permission denied");
    await expect(
      db.query("select * from private.academic_candidates"),
    ).rejects.toThrow("permission denied");
    await expect(
      db.query("select * from private.academic_audit"),
    ).rejects.toThrow("permission denied");
    expect((await academicPublic()).results).toEqual([]);
    expect((await academicPublic()).publishedAt).toBeNull();
  });
  it("0 分與空白不同，公布前沒有分數外洩，一次公布同一批快照", async () => {
    const w = await academicSetup();
    await academicSave(w.candidates[0], 0);
    await academicSave(w.candidates[1], 100);
    expect((await academicPublic()).results).toEqual([]);
    await asUser(null, "anon");
    const board = (
      await db.query<{ value: any }>("select public.get_scoreboard() value")
    ).rows[0].value;
    expect(JSON.stringify(board)).not.toContain("E001");
    await asUser(examiner);
    const ready = await academicWorkspace();
    expect(ready.candidates.map((c: any) => c.score)).toEqual([0, 100, null]);
    const request = crypto.randomUUID();
    await db.query("select public.publish_academic($1,$2)", [
      ready.version,
      request,
    ]);
    await db.query("select public.publish_academic($1,$2)", [
      ready.version,
      request,
    ]);
    expect(
      (await academicWorkspace()).audit.filter(
        (a: any) => a.action === "publish",
      ),
    ).toHaveLength(1);
    await asUser(null, "anon");
    const published = await academicPublic();
    expect(published.results.map((c: any) => c.passed)).toEqual([false, true]);
    expect(published.results.map((c: any) => c.name)).toEqual([
      "陳o安",
      "林o晴",
    ]);
    expect(
      new Set(published.results.map((c: any) => c.published_at)).size,
    ).toBe(1);
    expect(Object.keys(published.results[0]).sort()).toEqual([
      "id",
      "name",
      "number",
      "passed",
      "published_at",
    ]);
    await expect(
      db.query("update public.academic_results set score=1"),
    ).rejects.toThrow("permission denied");
    for (const [id, role] of [
      [null, "anon"],
      [outsider, "authenticated"],
      [examiner, "authenticated"],
    ] as const) {
      await asUser(id, role);
      await expect(
        db.query("select name,score from public.academic_results"),
      ).rejects.toThrow("permission denied");
      expect((await academicPublic()).results[0]).not.toHaveProperty("score");
    }
    const staff = await academicWorkspace();
    expect(staff.candidates[0].name).toBe("陳宥安");
    expect(staff.candidates[0].published_score).toBe(0);
  });
  it("修改留在草稿，再次公布才更新；过期确认不接受", async () => {
    const w = await academicSetup();
    await academicSave(w.candidates[0], 80);
    const staleVersion = w.version;
    await expect(
      db.query("select public.publish_academic($1,$2)", [
        staleVersion,
        crypto.randomUUID(),
      ]),
    ).rejects.toThrow("已更新");
    const ready = await academicWorkspace();
    await db.query("select public.publish_academic($1,$2)", [
      ready.version,
      crypto.randomUUID(),
    ]);
    await academicSave(ready.candidates[0], 79.9);
    expect((await academicPublic()).results[0].passed).toBe(true);
    const revised = await academicWorkspace();
    await db.query("select public.publish_academic($1,$2)", [
      revised.version,
      crypto.randomUUID(),
    ]);
    expect((await academicPublic()).results[0].passed).toBe(false);
  });
  it("分數邊界、重送及版本衝突由後端驗證", async () => {
    const w = await academicSetup();
    for (const score of [-1, 100.1, null, "90"])
      await expect(academicSave(w.candidates[0], score)).rejects.toThrow();
    const request = crypto.randomUUID();
    await academicSave(w.candidates[0], 88.5, request);
    await academicSave(w.candidates[0], 88.5, request);
    expect((await academicWorkspace()).candidates[0].revision).toBe(1);
    await expect(academicSave(w.candidates[0], 90, request)).rejects.toThrow(
      "其他內容",
    );
    await expect(academicSave(w.candidates[0], 90)).rejects.toThrow(
      "成績已被更新",
    );
  });
  it("名單整批回滾，沒有分數不能公布，額外欄位不儲存", async () => {
    await academicSetup();
    await expect(
      db.query("select public.publish_academic($1,$2)", [
        (await academicWorkspace()).version,
        crypto.randomUUID(),
      ]),
    ).rejects.toThrow("尚無");
    await expect(
      db.query("select public.import_academic($1)", [
        JSON.stringify([
          { number: "E004", name: "許家佑" },
          { number: "E001", name: "陳宥安" },
        ]),
      ]),
    ).rejects.toThrow("duplicate");
    expect((await academicWorkspace()).candidates).toHaveLength(3);
    await expect(
      db.query("select public.import_academic($1)", [
        JSON.stringify([
          { number: "E004", name: "許家佑", organization: "不得儲存" },
        ]),
      ]),
    ).rejects.toThrow("只接受");
  });
  it("挑戰賽梯次有後端限制且學校欄位確實移除", async () => {
    await asUser(admin);
    for (const heat of [0, 3, 1.5])
      await expect(
        db.query("select public.import_teams($1)", [
          JSON.stringify([
            {
              team_number: "機A001",
              name: "陳宥安",
              category_id: "creative",
              heat,
            },
          ]),
        ]),
      ).rejects.toThrow();
    await db.query("select public.import_teams($1)", [
      JSON.stringify([
        {
          team_number: "程C001",
          name: "陳宥安",
          category_id: "program",
          heat: 3,
        },
      ]),
    ]);
    const row = (await db.query<{ heat: number }>("select * from public.teams"))
      .rows[0];
    expect(row.heat).toBe(3);
    expect(row).not.toHaveProperty("organization");
    await expect(
      db.query("select public.import_teams($1)", [
        JSON.stringify([
          {
            team_number: "程A002",
            name: "陳宥安",
            category_id: "program",
            heat: 1,
            organization: "不得儲存",
          },
        ]),
      ]),
    ).rejects.toThrow("不接受");
    await expect(
      db.query("select public.import_teams($1)", [
        JSON.stringify([
          {
            team_number: "機A003",
            name: "前綴錯誤",
            category_id: "program",
            heat: 1,
          },
        ]),
      ]),
    ).rejects.toThrow("teams_number_category");
    await expect(
      db.query("select public.import_teams($1)", [
        JSON.stringify([
          {
            team_number: "機B004",
            name: "梯次錯誤",
            category_id: "creative",
            heat: 1,
          },
        ]),
      ]),
    ).rejects.toThrow("teams_number_heat");
  });
  it("科創 40 秒有效，40.01 秒拒絕；動力仍是 30 秒", async () => {
    const id = await createTeam("creative");
    const data = { regular: 5, red: "none", blue: "none", seconds: 40 };
    expect(
      (await submit(input(id, "creative", "left", data))).score_data.seconds,
    ).toBe(40);
    await expect(
      submit(input(id, "creative", "right", { ...data, seconds: 40.01 })),
    ).rejects.toThrow("有效範圍");
    const power = await createTeam("power", "動A002");
    await expect(
      submit(input(power, "power", "pull-1", { bottles: 7, seconds: 40 })),
    ).rejects.toThrow("有效範圍");
  });
});
afterAll(async () => {
  await db.close();
});
describe("Supabase/Postgres 整合與權限", () => {
  it("匿名只能讀取公開成績，不能直接寫入", async () => {
    await createTeam();
    const staffBoard = (
      await db.query<{ board: any }>("select public.get_scoreboard() board")
    ).rows[0].board;
    expect(staffBoard.teams[0].name).toBe("陳宥安");
    await asUser(null, "anon");
    const publicBoard = (
      await db.query<{ board: any }>("select public.get_scoreboard() board")
    ).rows[0].board;
    expect(publicBoard.teams[0].name).toBe("陳o安");
    await expect(db.query("select * from public.teams")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      db.query("update public.teams set name='Hacked'"),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query("select * from private.audit_log")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      db.query("select public.import_teams($1)", ["[]"]),
    ).rejects.toThrow(/permission denied/);
  });
  it("已登入但不在白名單不能送分", async () => {
    const id = await createTeam();
    await asUser(outsider);
    await expect(submit(input(id))).rejects.toThrow("沒有操作權限");
  });
  it("裁判可在計分名單報到，且只接受兩種報到狀態", async () => {
    const id = await createTeam("power");
    await asUser(admin);
    await db.query("select public.set_checkin($1,'pending')", [id]);
    await asUser(judge);
    await db.query("select public.set_checkin($1,'checked_in')", [id]);
    const checked = (
      await db.query<{ checkin_status: string; checked_in_at: string }>(
        "select checkin_status,checked_in_at from public.teams where id=$1",
        [id],
      )
    ).rows[0];
    expect(checked.checkin_status).toBe("checked_in");
    expect(checked.checked_in_at).toBeTruthy();
    await expect(
      db.query("select public.set_checkin($1,'absent')", [id]),
    ).rejects.toThrow("報到狀態不正確");
  });
  it("報到人員不能計分、裁判不能匯入且不能跨組", async () => {
    const id = await createTeam("creative");
    await asUser(checkin);
    await expect(
      submit(
        input(id, "creative", "left", {
          regular: 1,
          red: "none",
          blue: "none",
          seconds: 10,
        }),
      ),
    ).rejects.toThrow("沒有操作權限");
    await asUser(judge);
    await expect(
      db.query("select public.import_teams($1)", ["[]"]),
    ).rejects.toThrow("沒有操作權限");
    await expect(
      submit(
        input(id, "creative", "left", {
          regular: 1,
          red: "none",
          blue: "none",
          seconds: 10,
        }),
      ),
    ).rejects.toThrow("沒有此組別");
  });
  it("未報到拒絕，錯誤回合與超時拒絕", async () => {
    const id = await createTeam();
    await asUser(admin);
    await db.query("select public.set_checkin($1,'pending')", [id]);
    await expect(submit(input(id))).rejects.toThrow("尚未報到");
    await db.query("select public.set_checkin($1,'checked_in')", [id]);
    await expect(submit(input(id, "power", "left"))).rejects.toThrow(
      "回合不正確",
    );
    await expect(
      submit(input(id, "power", "pull-1", { bottles: 7, seconds: 31 })),
    ).rejects.toThrow("超出有效範圍");
  });
  it("重送相同請求只記一次；舊版本與修改無原因拒絕", async () => {
    const id = await createTeam();
    await asUser(judge);
    const p = input(id),
      a = await submit(p),
      b = await submit(p);
    expect(a.id).toBe(b.id);
    expect(b.revision).toBe(1);
    expect((await db.query("select * from public.attempts")).rows).toHaveLength(
      1,
    );
    await expect(
      submit({ ...p, request_id: crypto.randomUUID() }),
    ).rejects.toThrow("已被更新");
    await expect(
      submit({ ...p, request_id: crypto.randomUUID(), expected_revision: 1 }),
    ).rejects.toThrow("請填寫");
    const changed = await submit({
      ...p,
      request_id: crypto.randomUUID(),
      expected_revision: 1,
      reason: "輸入修正",
      score_data: { bottles: 9, seconds: 21 },
    });
    expect(changed.revision).toBe(2);
    await asUser(admin);
    const audit = await db.query<{ result: any }>(
      "select public.read_audit() result",
    );
    expect(
      audit.rows[0].result.filter((r: any) => r.action.startsWith("score")),
    ).toHaveLength(2);
  });
  it("相同識別碼不同內容拒絕；內部理由不出現在公开資料", async () => {
    const id = await createTeam();
    const p = { ...input(id), reason: "內部備註 ABC" };
    await submit(p);
    await expect(
      submit({ ...p, score_data: { bottles: 8, seconds: 20 } }),
    ).rejects.toThrow("其他內容");
    await asUser(null, "anon");
    expect(
      JSON.stringify((await db.query("select public.get_scoreboard()")).rows),
    ).not.toContain("內部備註");
  });
  it("同一參賽者程式組重量不得不一致", async () => {
    const id = await createTeam("program");
    await submit(
      input(id, "program", "round-1", {
        completed: 1,
        seconds: 20,
        weight: 500,
      }),
    );
    await expect(
      submit(
        input(id, "program", "round-2", {
          completed: 1,
          seconds: 19,
          weight: 501,
        }),
      ),
    ).rejects.toThrow("須與另一回合一致");
  });
  it("動力 SQL 與前端計算一致", async () => {
    const id = await createTeam();
    for (const [slot, bottles, seconds] of [
      ["pull-1", 10, 25],
      ["pull-2", 7, 5],
      ["push-1", 9, 20],
      ["push-2", 9, 18],
    ])
      await submit(input(id, "power", String(slot), { bottles, seconds }));
    const { rows } = await db.query<any>("select * from public.results");
    expect(Number(rows[0].primary_score)).toBe(19);
    expect(Number(rows[0].secondary_score)).toBe(43);
  });
  it("四組資料完整性及排名與前端一致", async () => {
    for (const category of [
      "preschool",
      "power",
      "program",
      "creative",
    ] as const)
      for (let i = 1; i <= 4; i++) {
        const id = await createTeam(
          category,
          prefixes[category] + "A" + String(i + 1).padStart(3, "0"),
        );
        if (category === "preschool")
          await submit(
            input(id, category, "round-1", { childGoals: 2, parentGoals: 1 }),
          );
        if (category === "power") {
          await submit(
            input(id, category, "pull-1", { bottles: 7, seconds: 20 }),
          );
          await submit(
            input(id, category, "push-1", { bottles: 7, seconds: 20 }),
          );
        }
        if (category === "program")
          await submit(
            input(id, category, "round-1", {
              completed: 1,
              seconds: 15,
              weight: [400, 500, 500, 600][i - 1],
            }),
          );
        if (category === "creative")
          await submit(
            input(id, category, "left", {
              regular: i,
              red: "correct",
              blue: "wrong",
              seconds: 20,
            }),
          );
      }
    const {
      rows: [{ board }],
    } = await db.query<{ board: any }>("select public.get_scoreboard() board");
    const teams: Team[] = board.teams.map((t: any) => ({
      id: t.id,
      number: t.team_number,
      name: t.name,
      heat: t.heat,
      categoryId: t.category_id,
      checkinStatus: t.checkin_status,
      checkedInAt: t.checked_in_at,
    }));
    const attempts: Attempt[] = board.attempts.map((a: any) => ({
      id: a.id,
      teamId: a.team_id,
      categoryId: a.category_id,
      slotKey: a.slot_key,
      attemptNo: a.attempt_no,
      status: a.status,
      data: a.score_data,
      submittedAt: a.submitted_at,
    }));
    for (const category of [
      "preschool",
      "power",
      "program",
      "creative",
    ] as const)
      for (const client of leaderboard(teams, attempts, category)) {
        const sql = board.results.find(
          (r: any) => r.team_id === client.team.id,
        );
        expect(client.primary).toEqual(sql.primary_score);
        expect(client.secondary).toEqual(sql.secondary_score);
        expect(client.rank).toEqual(sql.rank);
        expect(client.qualified).toEqual(sql.qualified);
      }
  });
  it("資料庫依梯次單獨計算名次", async () => {
    const entries = [
      ["程A001", 1, 15],
      ["程A002", 1, 18],
      ["程B001", 2, 20],
      ["程B002", 2, 10],
    ] as const;
    const ids = new Map<string, string>();
    for (const [number, heat, seconds] of entries) {
      const id = await createTeam("program", number, heat);
      ids.set(number, id);
      await submit(
        input(id, "program", "round-1", {
          completed: 1,
          seconds,
          weight: 600,
        }),
      );
    }
    const { rows } = await db.query<{ team_id: string; rank: number }>(
      "select team_id,rank from public.results",
    );
    const rankByNumber = Object.fromEntries(
      entries.map(([number]) => [
        number,
        rows.find((row) => row.team_id === ids.get(number))?.rank,
      ]),
    );
    expect(rankByNumber).toEqual({
      程A001: 1,
      程A002: 2,
      程B001: 2,
      程B002: 1,
    });
  });
  it("匯入重複會整批回滾，不覆蓋既有資料", async () => {
    await createTeam();
    await expect(
      db.query("select public.import_teams($1)", [
        JSON.stringify([
          {
            team_number: "動A002",
            name: "New",
            category_id: "power",
            heat: 1,
          },
          {
            team_number: "動A001",
            name: "Overwrite",
            category_id: "power",
            heat: 1,
          },
        ]),
      ]),
    ).rejects.toThrow(/duplicate key/);
    expect((await db.query("select * from public.teams")).rows).toHaveLength(1);
  });
  it("120 人快照、版本檢查與更新通知", async () => {
    await asUser(admin);
    const categories = ["preschool", "power", "program", "creative"];
    const rows = Array.from({ length: 120 }, (_, i) => ({
      team_number:
        prefixes[categories[i % 4]] +
        "A" +
        String(Math.floor(i / 4) + 1).padStart(3, "0"),
      name: demoTeams[i % demoTeams.length].name,
      category_id: categories[i % 4],
      heat: 1,
    }));
    await db.query("select public.import_teams($1)", [JSON.stringify(rows)]);
    const snapshot = (
      await db.query<{ b: any }>("select public.get_scoreboard() b")
    ).rows[0].b;
    expect(snapshot.teams).toHaveLength(120);
    expect(snapshot.results).toHaveLength(120);
    const unchanged = (
      await db.query<{ b: any }>("select public.get_scoreboard($1) b", [
        snapshot.version,
      ])
    ).rows[0].b;
    expect(unchanged.unchanged).toBe(true);
    expect(unchanged.teams).toBeUndefined();
    await db.query("select public.set_checkin($1,'checked_in')", [
      snapshot.teams[0].id,
    ]);
    const changed = (
      await db.query<{ b: any }>("select public.get_scoreboard($1) b", [
        snapshot.version,
      ])
    ).rows[0].b;
    expect(changed.version).toBeGreaterThan(snapshot.version);
    expect(changed.teams[0].checkin_status).toBe("checked_in");
  });
  it("無效回合不會洩漏未驗證的任意欄位", async () => {
    const id = await createTeam();
    await submit({
      ...input(id),
      status: "invalid",
      reason: "掉落",
      score_data: {
        bottles: 8,
        seconds: 45,
        failureReason: "超過邊界",
        secret: "do not publish",
      },
    });
    await asUser(null, "anon");
    const s = (await db.query<{ b: any }>("select public.get_scoreboard() b"))
      .rows[0].b;
    expect(s.attempts[0].score_data).toEqual({
      bottles: 8,
      seconds: 45,
      failureReason: "超過邊界",
    });
    expect(s.results[0].rank).toBeNull();
  });
});
