export type CategoryId = "preschool" | "power" | "program" | "creative";
export type CheckinStatus = "pending" | "checked_in";
// One record is one individual entrant; the legacy identifier preserves API compatibility.
export type Team = {
  id: string;
  number: string;
  name: string;
  heat: number;
  categoryId: CategoryId;
  checkinStatus: CheckinStatus;
  checkedInAt: string | null;
};
export function maskParticipantName(name: string) {
  const characters = Array.from(name.trim());
  if (characters.length < 2) return characters.join("");
  characters[1] = "o";
  return characters.join("");
}
export function compareParticipantNumbers(
  left: Pick<Team, "number">,
  right: Pick<Team, "number">,
) {
  return left.number.localeCompare(right.number, "en", {
    numeric: true,
    sensitivity: "base",
  });
}
export const heatCount = (category: CategoryId) =>
  category === "program" ? 3 : 2;
export const heatNumbers = (category: CategoryId) =>
  Array.from({ length: heatCount(category) }, (_, i) => i + 1);
export function categoryStats(
  teams: Team[],
  attempts: Attempt[],
  category: CategoryId,
) {
  const entrants = teams.filter((t) => t.categoryId === category);
  return {
    total: entrants.length,
    checkedIn: entrants.filter((t) => t.checkinStatus === "checked_in").length,
    completed: entrants.filter((t) =>
      slotOptions(category).every(([slot]) =>
        attempts.some((a) => a.teamId === t.id && a.slotKey === slot),
      ),
    ).length,
  };
}
export type AttemptStatus = "valid" | "invalid" | "terminated";
export const failureReasons: Record<CategoryId, string[]> = {
  preschool: [],
  power: ["超過邊界", "車體鬆脫", "飲料罐掉落"],
  program: ["超過邊界", "車體鬆脫", "飲料罐掉落"],
  creative: ["車體掉出場地", "零件脫落", "翻覆"],
};
export type Attempt = {
  id: string;
  teamId: string;
  categoryId: CategoryId;
  slotKey: string;
  attemptNo: number;
  status: AttemptStatus;
  failureReason?: string;
  revision?: number;
  data: Record<string, number | string | boolean>;
  submittedAt: string;
};
export const categories: {
  id: CategoryId;
  name: string;
  eventName: string;
  subtitle: string;
  court: string;
}[] = [
  {
    id: "preschool",
    name: "幼兒簡易機械組",
    eventName: "寶礦力水得足球世界盃",
    subtitle: "熱血世界盃",
    court: "A 場",
  },
  {
    id: "power",
    name: "動力機械組",
    eventName: "寶礦力水得大搬運",
    subtitle: "寶礦力水得大搬運",
    court: "B 場",
  },
  {
    id: "program",
    name: "程式機械組",
    eventName: "寶礦力水得智慧物流折返跑",
    subtitle: "智慧物流折返跑",
    court: "C 場",
  },
  {
    id: "creative",
    name: "科創機器人組",
    eventName: "決戰寶礦力",
    subtitle: "決戰寶礦力",
    court: "D 場",
  },
];
const n = (a: Attempt, k: string) => Number(a.data[k] ?? 0);
const cmp = (a: number, b: number) => Math.abs(a - b) < 1e-9;
export type Result = {
  team: Team;
  primary: number | null;
  secondary: number | null;
  qualified: boolean;
  complete: boolean;
  summary: string;
  rank: number | null;
};
export function creativeScore(a: Attempt) {
  return (
    n(a, "regular") * 10 +
    (a.data.red === "correct" ? 20 : a.data.red === "wrong" ? 5 : 0) +
    (a.data.blue === "correct" ? 20 : a.data.blue === "wrong" ? 5 : 0)
  );
}
export function teamResult(
  team: Team,
  attempts: Attempt[],
): Omit<Result, "rank"> {
  const rows = attempts.filter((a) => a.teamId === team.id);
  if (team.categoryId === "preschool") {
    const best =
      rows
        .filter((a) => a.status === "valid")
        .map((a) => n(a, "childGoals") + n(a, "parentGoals"))
        .sort((a, b) => b - a)[0] ?? null;
    return {
      team,
      primary: best,
      secondary: null,
      qualified: best !== null && best >= 3,
      complete: rows.length >= 2,
      summary: best === null ? "尚無成績" : "最佳回合進球數 " + best + " 球",
    };
  }
  if (team.categoryId === "power") {
    const pick = (direction: string) =>
      rows
        .filter(
          (a) =>
            a.slotKey.startsWith(direction) &&
            a.status === "valid" &&
            n(a, "seconds") <= 30,
        )
        .sort(
          (a, b) =>
            n(b, "bottles") - n(a, "bottles") ||
            n(a, "seconds") - n(b, "seconds"),
        )[0];
    const pull = pick("pull"),
      push = pick("push");
    const hasBoth = Boolean(pull && push);
    const load = hasBoth ? n(pull!, "bottles") + n(push!, "bottles") : null,
      seconds = hasBoth ? n(pull!, "seconds") + n(push!, "seconds") : null;
    const directionSummary = (
      label: string,
      direction: string,
      best?: Attempt,
    ) =>
      `${label}：${best ? n(best, "bottles") + " 瓶" : rows.filter((a) => a.slotKey.startsWith(direction)).length >= 2 ? "未完成" : "待完成"}`;
    return {
      team,
      primary: load,
      secondary: seconds,
      qualified:
        hasBoth &&
        rows.some(
          (a) =>
            a.status === "valid" &&
            n(a, "bottles") >= 7 &&
            n(a, "seconds") <= 30,
        ),
      complete: slotOptions("power").every(([slot]) =>
        rows.some((a) => a.slotKey === slot),
      ),
      summary: hasBoth
        ? load + " 瓶 · " + seconds!.toFixed(1) + " 秒"
        : `${directionSummary("拉動", "pull", pull)} · ${directionSummary("推動", "push", push)}`,
    };
  }
  if (team.categoryId === "program") {
    const valid = rows
      .filter(
        (a) =>
          a.status === "valid" &&
          n(a, "completed") === 1 &&
          n(a, "seconds") <= 25,
      )
      .sort((a, b) => n(a, "seconds") - n(b, "seconds"));
    const best = valid[0],
      seconds = best ? n(best, "seconds") : null,
      weight = best ? n(best, "weight") : null;
    return {
      team,
      primary: seconds,
      secondary: weight,
      qualified: seconds !== null && seconds <= 25,
      complete: rows.length >= 2,
      summary:
        seconds === null
          ? rows.length >= 2
            ? "未達合格標準"
            : "尚未完成"
          : seconds.toFixed(1) + " 秒 · " + weight + " g",
    };
  }
  const valid = rows
    .filter((a) => a.status === "valid")
    .sort(
      (a, b) =>
        creativeScore(b) - creativeScore(a) ||
        n(a, "seconds") - n(b, "seconds"),
    );
  const best = valid[0],
    score = best ? creativeScore(best) : null,
    seconds = best ? n(best, "seconds") : null;
  return {
    team,
    primary: score,
    secondary: seconds,
    qualified: score !== null && score >= 50,
    complete: rows.length >= 2,
    summary:
      score === null
        ? rows.length >= 2
          ? "未達合格標準"
          : "尚無成績"
        : score + " 分 · " + seconds!.toFixed(1) + " 秒",
  };
}
export function challengeStatus(
  result: { team: Team; qualified: boolean; primary: number | null },
  attemptCount: number,
) {
  if (result.team.checkinStatus !== "checked_in")
    return { label: "尚未報到", tone: "status-not-checked" };
  if (result.qualified) return { label: "挑戰成功", tone: "status-success" };
  if (!attemptCount) return { label: "等待挑戰", tone: "status-waiting" };
  if (attemptCount < slotOptions(result.team.categoryId).length)
    return { label: "挑戰中", tone: "status-waiting" };
  return { label: "未達合格標準", tone: "status-incomplete" };
}
export function leaderboard(
  teams: Team[],
  attempts: Attempt[],
  categoryId: CategoryId,
): Result[] {
  const base = teams
    .filter((t) => t.categoryId === categoryId)
    .map((t) => teamResult(t, attempts));
  base.sort((a, b) => {
    if (categoryId === "preschool")
      return a.team.number.localeCompare(b.team.number);
    if (a.primary === null && b.primary === null)
      return a.team.number.localeCompare(b.team.number);
    if (a.primary === null) return 1;
    if (b.primary === null) return -1;
    if (categoryId === "program")
      return (
        a.primary - b.primary ||
        (a.secondary ?? Infinity) - (b.secondary ?? Infinity)
      );
    return (
      b.primary - a.primary ||
      (a.secondary ?? Infinity) - (b.secondary ?? Infinity)
    );
  });
  const heatRanks = new Map<
    number,
    {
      last?: Omit<Result, "rank">;
      lastRank: number;
      position: number;
    }
  >();
  return base.map((r) => {
    const state = heatRanks.get(r.team.heat) ?? {
      lastRank: 0,
      position: 0,
    };
    state.position += 1;
    const same =
      state.last &&
      r.primary !== null &&
      cmp(r.primary, state.last.primary!) &&
      ((r.secondary === null && state.last.secondary === null) ||
        (r.secondary !== null &&
          state.last.secondary !== null &&
          cmp(r.secondary, state.last.secondary)));
    if (!same) state.lastRank = state.position;
    state.last = r;
    heatRanks.set(r.team.heat, state);
    return {
      ...r,
      rank:
        r.primary === null || categoryId === "preschool"
          ? null
          : state.lastRank,
    };
  });
}
export const slotOptions = (category: CategoryId) =>
  category === "power"
    ? [
        ["pull-1", "拉動第 1 次"],
        ["pull-2", "拉動第 2 次"],
        ["push-1", "推動第 1 次"],
        ["push-2", "推動第 2 次"],
      ]
    : category === "creative"
      ? [
          ["left", "朝左出發"],
          ["right", "朝右出發"],
        ]
      : [
          ["round-1", "第 1 回合"],
          ["round-2", "第 2 回合"],
        ];
export function validateScore(
  category: CategoryId,
  status: AttemptStatus,
  data: Record<string, number | string | boolean>,
  reason: string,
): string | null {
  const number = (key: string, min: number, max: number, integer = false) =>
    typeof data[key] === "number" &&
    Number.isFinite(data[key]) &&
    Number(data[key]) >= min &&
    Number(data[key]) <= max &&
    (!integer || Number.isInteger(data[key]));
  if (status === "terminated")
    return "不再提供提前終止，請依本回合結果選擇完成或未完成";
  if (status === "invalid") {
    if (category === "preschool")
      return "幼兒組請直接記錄進球數，不使用未完成狀態";
    if (!failureReasons[category].includes(String(data.failureReason ?? "")))
      return "請選擇未完成原因";
    if (
      data.seconds !== undefined &&
      data.seconds !== "" &&
      !number("seconds", 0, Number.MAX_SAFE_INTEGER)
    )
      return "未完成秒數可留空；填寫時須為非負數字";
    if (category === "power" && !number("bottles", 0, 999, true))
      return "請記錄 0–999 的瓶數";
    if (category === "program" && !number("weight", 0.1, 100000))
      return "請記錄車頭淨重";
    if (
      category === "creative" &&
      (!number("regular", 0, 8, true) ||
        !["none", "correct", "wrong"].includes(String(data.red)) ||
        !["none", "correct", "wrong"].includes(String(data.blue)))
    )
      return "請記錄普通瓶與特殊瓶數據";
    return null;
  }
  if (
    category === "preschool" &&
    (!number("childGoals", 0, 4, true) || !number("parentGoals", 0, 2, true))
  )
    return "小朋友進球須為 0–4，家長進球須為 0–2";
  if (
    category === "power" &&
    (!number("bottles", 0, 999, true) || !number("seconds", 0.1, 30))
  )
    return "請輸入瓶數與 0.1–30 秒內的有效成績";
  if (
    category === "program" &&
    (!number("seconds", 0.1, 25) ||
      !number("weight", 0.1, 100000) ||
      data.completed !== 1)
  )
    return "請確認完成，並輸入 0.1–25 秒及車頭重量";
  if (
    category === "creative" &&
    (!number("regular", 0, 8, true) ||
      !["none", "correct", "wrong"].includes(String(data.red)) ||
      !["none", "correct", "wrong"].includes(String(data.blue)) ||
      !number("seconds", 0, 40))
  )
    return "請檢查普通瓶、特殊瓶及時間（0–40 秒）";
  return null;
}
export function normalizeScore(
  status: AttemptStatus,
  data: Record<string, number | string | boolean>,
) {
  const d = { ...data };
  if (status !== "invalid") delete d.failureReason;
  else {
    if (d.seconds === "") delete d.seconds;
    if ("completed" in d) d.completed = 0;
  }
  for (const k of ["seconds", "weight"])
    if (typeof d[k] === "number")
      d[k] = Math.round((Number(d[k]) + Number.EPSILON) * 10) / 10;
  return d;
}
export function attemptSummary(a: Attempt): string {
  if (a.status === "invalid" || a.status === "terminated") {
    const values: string[] = [];
    if (typeof a.data.bottles === "number") values.push(`${a.data.bottles} 瓶`);
    if (a.categoryId === "creative" && typeof a.data.regular === "number")
      values.push(`${creativeScore(a)} 分（紀錄）`);
    if (typeof a.data.seconds === "number")
      values.push(`${a.data.seconds.toFixed(1)} 秒`);
    if (typeof a.data.weight === "number") values.push(`${a.data.weight} g`);
    return ["未完成", a.data.failureReason, ...values]
      .filter(Boolean)
      .join(" · ");
  }
  if (a.categoryId === "preschool")
    return "進球數 " + String(n(a, "childGoals") + n(a, "parentGoals")) + " 球";
  if (a.categoryId === "power")
    return n(a, "bottles") + " 瓶 · " + n(a, "seconds").toFixed(1) + " 秒";
  if (a.categoryId === "program")
    return n(a, "seconds").toFixed(1) + " 秒 · " + n(a, "weight") + " g";
  return creativeScore(a) + " 分 · " + n(a, "seconds").toFixed(1) + " 秒";
}
