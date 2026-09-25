import { parseCSV } from "./csv";
import { isDemoMode, supabase } from "./supabase";
import { academicRequest } from "./academic-request";
import { maskParticipantName } from "./domain";
import {
  academicLevel,
  academicLevels,
  academicLevelName,
  normalizeAcademicNumber,
  type AcademicLevel,
} from "./academic-levels";

export type AcademicRosterRow = { number: string; name: string };
export type AcademicCandidate = AcademicRosterRow & {
  id: string;
  score: number | null;
  revision: number;
  updated_at: string;
  published_score: number | null;
  practical_completed?: boolean | null;
  published_practical_completed?: boolean | null;
};
export type AcademicResult = AcademicRosterRow & {
  id: string;
  passed: boolean;
  practical_completed: boolean | null;
  overall_passed: boolean | null;
  published_at: string;
};
// Also accepts the previous RPC shape during the staged frontend/backend update.
// Never retain exact grades or full names in the parent-facing data model.
export function publicAcademicResult(
  row: AcademicRosterRow & {
    id: string;
    published_at: string;
    passed?: boolean;
    score?: number;
    practical_completed?: boolean | null;
  },
): AcademicResult {
  const passed =
    typeof row.passed === "boolean"
      ? row.passed
      : typeof row.score === "number" &&
          Number.isFinite(row.score) &&
          row.score >= 0 &&
          row.score <= 100
        ? row.score >= 80
        : null;
  if (passed === null) throw new Error("成績資料不完整，請重新整理後再試");
  return {
    id: row.id,
    number: row.number,
    name: maskParticipantName(row.name),
    passed,
    practical_completed: row.practical_completed ?? null,
    overall_passed:
      typeof row.practical_completed === "boolean"
        ? passed && row.practical_completed
        : null,
    published_at: row.published_at,
  };
}
export type AcademicAudit = {
  id: number;
  number?: string;
  action: string;
  actor_id: string;
  reason?: string;
  created_at: string;
  old_value?: unknown;
  new_value?: unknown;
};
export type AcademicWorkspace = {
  version: number;
  publishedAt: string | null;
  candidates: AcademicCandidate[];
  audit: AcademicAudit[];
};
export type AcademicPublic = {
  version: number;
  publishedAt: string | null;
  results: AcademicResult[];
};
export type AcademicSave = {
  id: string;
  score: number | null;
  practical_completed?: boolean | null;
  reason: string;
  expected_revision: number;
  request_id: string;
};
export function parseAcademicCSV(
  text: string,
  expectedLevel?: AcademicLevel,
): AcademicRosterRow[] {
  const [headers, ...rows] = parseCSV(text);
  if (!headers || rows.length < 1 || rows.length > 500)
    throw new Error("每次請匯入 1–500 位參賽者");
  const ni = headers.findIndex((x) => ["參賽編號", "number"].includes(x));
  const na = headers.findIndex((x) => ["姓名", "name"].includes(x));
  if (headers.length !== 2 || ni < 0 || na < 0)
    throw new Error("學科名單只接受「參賽編號、姓名」兩欄，請下載範本後填寫");
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const number = normalizeAcademicNumber(row[ni] ?? ""),
      name = row[na];
    if (
      row.length !== 2 ||
      !number ||
      !name ||
      number.length > 32 ||
      name.length > 100
    )
      throw new Error(`第 ${index + 2} 列：請檢查參賽編號及姓名`);
    if (expectedLevel && academicLevel(number) !== expectedLevel) {
      const range = academicLevels.find((item) => item.id === expectedLevel)!;
      throw new Error(
        `第 ${index + 2} 列：${number} 不屬於${academicLevelName(expectedLevel)}，請使用 ${range.first}～${range.last}`,
      );
    }
    if (seen.has(number)) throw new Error("重複參賽編號：" + number);
    seen.add(number);
    return { number, name };
  });
}
export function academicScore(value: string): number {
  if (!value.trim() || !/^\d+(\.\d)?$/.test(value.trim()))
    throw new Error("請輸入 0–100 分，最多一位小數；空白不代表 0 分");
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100)
    throw new Error("學科成績須介於 0–100 分");
  return n;
}
// Ephemeral demonstration only. Real grades are fetched through protected RPCs.
export class AcademicDemoStore {
  private workspace: AcademicWorkspace;
  private publicSnapshot: AcademicPublic = {
    version: 0,
    publishedAt: null,
    results: [],
  };
  private receipts = new Map<string, string>();
  constructor(rows: AcademicRosterRow[] = []) {
    this.workspace = {
      version: 0,
      publishedAt: null,
      audit: [],
      candidates: rows.map((r, i) => ({
        ...r,
        id: "academic-demo-" + i,
        score: null,
        published_score: null,
        revision: 0,
        updated_at: new Date().toISOString(),
      })),
    };
  }
  readWorkspace() {
    return structuredClone(this.workspace);
  }
  readPublic() {
    return structuredClone(this.publicSnapshot);
  }
  import(rows: AcademicRosterRow[]) {
    const seen = new Set(this.workspace.candidates.map((c) => c.number));
    for (const r of rows) {
      if (seen.has(r.number)) throw new Error("重複參賽編號：" + r.number);
      seen.add(r.number);
    }
    const candidates = rows.map((r) => ({
      ...r,
      id: crypto.randomUUID(),
      score: null,
      published_score: null,
      revision: 0,
      updated_at: new Date().toISOString(),
    }));
    this.workspace.candidates.push(...candidates);
    for (const c of candidates)
      this.audit("import", c.number, "", undefined, c);
    this.workspace.version++;
  }
  save(input: AcademicSave) {
    const signature = JSON.stringify({ operation: "score", ...input });
    if (this.replayed(input.request_id, signature)) return;
    const c = this.workspace.candidates.find((c) => c.id === input.id);
    if (!c) throw new Error("找不到學科參賽者");
    if (c.revision !== input.expected_revision)
      throw new Error("成績已被更新，請重新載入後核對");
    if (
      (c.score !== null || c.practical_completed != null) &&
      !input.reason.trim()
    )
      throw new Error("請填寫修改原因");
    const score =
      input.score === null ? null : academicScore(String(input.score));
    const practical =
      input.practical_completed === undefined
        ? (c.practical_completed ?? null)
        : input.practical_completed;
    if (practical !== null && typeof practical !== "boolean")
      throw new Error("術科狀態不正確");
    if (score === null && practical === null)
      throw new Error("請至少登錄學科或術科成績");
    if (c.score !== null && score === null)
      throw new Error("已登錄學科不可清空");
    if (typeof c.practical_completed === "boolean" && practical === null)
      throw new Error("已登錄術科不可清空");
    const before = structuredClone(c);
    c.score = score;
    c.practical_completed = practical;
    c.revision++;
    c.updated_at = new Date().toISOString();
    this.audit("score", c.number, input.reason, before, c);
    this.workspace.version++;
    this.receipts.set(input.request_id, signature);
  }
  publish(version: number, requestId: string) {
    const signature = JSON.stringify({ operation: "publish", version });
    if (this.replayed(requestId, signature)) return;
    if (version !== this.workspace.version)
      throw new Error("名單或分數已更新，請重新確認公布人數與成績");
    const graded = this.workspace.candidates.filter((c) => c.score !== null);
    if (!graded.length) throw new Error("尚無可公布的學科成績");
    const stamp = new Date().toISOString();
    this.workspace.version++;
    this.publicSnapshot = {
      version: this.workspace.version,
      publishedAt: stamp,
      results: graded.map((c) =>
        publicAcademicResult({
          id: c.id,
          number: c.number,
          name: c.name,
          score: c.score!,
          practical_completed: c.practical_completed ?? null,
          published_at: stamp,
        }),
      ),
    };
    for (const c of graded) {
      c.published_score = c.score;
      c.published_practical_completed = c.practical_completed ?? null;
    }
    this.workspace.publishedAt = stamp;
    this.audit("publish", undefined, "", undefined, {
      count: graded.length,
      publishedAt: stamp,
    });
    this.receipts.set(requestId, signature);
  }
  private replayed(id: string, signature: string) {
    if (!id) throw new Error("缺少送出識別碼");
    const previous = this.receipts.get(id);
    if (previous && previous !== signature)
      throw new Error("送出識別碼已用於其他內容");
    return Boolean(previous);
  }
  private audit(
    action: string,
    number?: string,
    reason = "",
    old_value?: unknown,
    new_value?: unknown,
  ) {
    this.workspace.audit.unshift({
      id: this.workspace.audit.length + 1,
      number,
      action,
      reason,
      actor_id: "示範管理員",
      created_at: new Date().toISOString(),
      old_value: structuredClone(old_value),
      new_value: structuredClone(new_value),
    });
  }
}
const demoAcademic = new AcademicDemoStore(
  isDemoMode
    ? [
        { number: "E001", name: "陳宥安" },
        { number: "E002", name: "林芷晴" },
        { number: "E003", name: "黃品睿" },
        { number: "E004", name: "張語彤" },
      ]
    : [],
);
export async function getAcademicWorkspace(): Promise<AcademicWorkspace> {
  if (isDemoMode) return demoAcademic.readWorkspace();
  const { data, error } = await academicRequest((signal) =>
    supabase!.rpc("get_academic_workspace").abortSignal(signal),
  );
  if (error) throw error;
  return data;
}
export async function getAcademicPublic(): Promise<AcademicPublic> {
  if (isDemoMode) return demoAcademic.readPublic();
  const { data, error } = await supabase!.rpc("get_academic_results");
  if (error) throw error;
  return {
    version: data.version,
    publishedAt: data.publishedAt,
    results: data.results.map(publicAcademicResult),
  };
}
export async function importAcademic(rows: AcademicRosterRow[]) {
  if (isDemoMode) return demoAcademic.import(rows);
  const { error } = await academicRequest((signal) =>
    supabase!.rpc("import_academic", { p_rows: rows }).abortSignal(signal),
  );
  if (error) throw error;
}
export async function saveAcademic(input: AcademicSave) {
  if (isDemoMode) return demoAcademic.save(input);
  const { error } = await supabase!.rpc("save_academic_score", {
    p_input: input,
  });
  if (error) throw error;
}
export async function publishAcademic(version: number, requestId: string) {
  if (isDemoMode) return demoAcademic.publish(version, requestId);
  const { error } = await supabase!.rpc("publish_academic", {
    p_expected_version: version,
    p_request_id: requestId,
  });
  if (error) throw error;
}
