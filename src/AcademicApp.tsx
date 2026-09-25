import { EventNavigation } from "./EventNavigation";
import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Bot, Download, RefreshCw, ShieldCheck, Upload } from "./icons";
import { isDemoMode, supabase } from "./supabase";
import { getStaff, subscribe, type Staff } from "./data";
import { Login } from "./App";
import { downloadCSV } from "./csv";
import { academicImportError } from "./academic-request";
import {
  academicLevel,
  academicLevels,
  academicLevelName,
  academicLevelRows,
  academicRosterTemplate,
  normalizeAcademicNumber,
  type AcademicLevel,
  type AcademicLevelFilter,
} from "./academic-levels";
import {
  academicScore,
  getAcademicWorkspace,
  getAcademicPublic,
  importAcademic,
  parseAcademicCSV,
  publishAcademic,
  saveAcademic,
  type AcademicCandidate,
  type AcademicPublic,
  type AcademicRosterRow,
  type AcademicWorkspace,
} from "./academic";

function practicalLabel(value: boolean | null | undefined) {
  return value == null ? "尚未登錄" : value ? "完成" : "未完成";
}
function examOutcome(
  score: number | null,
  practical: boolean | null | undefined,
) {
  return score === null || practical == null
    ? "待確認"
    : score >= 80 && practical
      ? "通過"
      : "未通過";
}

export default function AcademicApp({ staffView }: { staffView: boolean }) {
  const [session, setSession] = useState<Session | null>(null);
  const [staff, setStaff] = useState<Staff | null>(
    isDemoMode
      ? { role: "admin", categoryIds: [], canGradeAcademic: true }
      : null,
  );
  const [authLoading, setAuthLoading] = useState(!isDemoMode);
  const [online, setOnline] = useState(navigator.onLine);
  const [workspace, setWorkspace] = useState<AcademicWorkspace | null>(null);
  const [publicData, setPublicData] = useState<AcademicPublic | null>(null);
  const [error, setError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<AcademicLevelFilter>(1);
  const [importLevel, setImportLevel] = useState<AcademicLevel>(1);
  const [selected, setSelected] = useState<AcademicCandidate | null>(null);
  const [scoreText, setScoreText] = useState("");
  const [practical, setPractical] = useState<boolean | null>(null);
  const [reason, setReason] = useState("");
  const [importRows, setImportRows] = useState<AcademicRosterRow[]>([]);
  const [importFeedback, setImportFeedback] = useState<{
    state: "pending" | "success" | "error";
    message: string;
  } | null>(null);
  const importPending = useRef(false);
  const importReadVersion = useRef(0);
  const [publishConfirmation, setPublishConfirmation] = useState<{
    version: number;
    count: number;
    missing: number;
    requestId: string;
  } | null>(null);
  const saveReceipt = useRef({ signature: "", id: "" });
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const canGrade = Boolean(
    (isDemoMode || (session && !authLoading)) &&
    staff &&
    (staff.role === "admin" ||
      (staff.role === "judge" && staff.canGradeAcademic)),
  );
  const canImport = staff?.role === "admin";
  useEffect(() => {
    const on = () => {
        setOnline(true);
        void refreshRef.current();
      },
      off = () => setOnline(false);
    addEventListener("online", on);
    addEventListener("offline", off);
    return () => {
      removeEventListener("online", on);
      removeEventListener("offline", off);
    };
  }, []);
  useEffect(() => {
    if (!supabase) return;
    let live = true,
      authChanged = false;
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (live && !authChanged) {
          setSession(data.session);
          setAuthLoading(Boolean(data.session));
        }
      })
      .catch(() => {
        if (live && !authChanged) {
          setAuthLoading(false);
          setError("登入狀態確認失敗，請重新整理後再試。");
        }
      });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      authChanged = true;
      setStaff(null);
      setWorkspace(null);
      setSelected(null);
      setPublishConfirmation(null);
      setAuthLoading(Boolean(next));
      setSession(next);
    });
    return () => {
      live = false;
      subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (isDemoMode) return;
    setStaff(null);
    if (!session) {
      setAuthLoading(false);
      return;
    }
    let live = true;
    setAuthLoading(true);
    void getStaff()
      .then((value) => {
        if (live) setStaff(value);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setAuthLoading(false);
      });
    return () => {
      live = false;
    };
  }, [session]);
  useEffect(() => {
    let live = true,
      pending = false;
    setWorkspace(null);
    setPublicData(null);
    setLoading(true);
    setSelected(null);
    setPublishConfirmation(null);
    setImportRows([]);
    setImportFeedback(null);
    importReadVersion.current += 1;
    setError("");
    setRefreshError("");
    setNotice("");
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        if (staffView) {
          if (!canGrade) return;
          const value = await getAcademicWorkspace();
          if (live) setWorkspace(value);
        } else {
          const value = await getAcademicPublic();
          if (live) setPublicData(value);
        }
        if (live) setRefreshError("");
      } catch (e) {
        if (live) setRefreshError("更新失敗：" + (e as Error).message);
      } finally {
        pending = false;
        if (live) setLoading(false);
      }
    };
    refreshRef.current = refresh;
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    const stop = subscribe(
      () => void refresh(),
      () => {},
    );
    return () => {
      live = false;
      clearInterval(timer);
      importReadVersion.current += 1;
      stop();
    };
  }, [staffView, canGrade, session?.user.id]);
  const candidates = workspace?.candidates ?? [];
  const graded = candidates.filter((c) => c.score !== null).length;
  const levelCandidates = academicLevelRows(candidates, level);
  const levelResults = academicLevelRows(publicData?.results ?? [], level);
  const levelGraded = levelCandidates.filter((c) => c.score !== null).length;
  const unknownCount = candidates.filter(
    (c) => academicLevel(c.number) === null,
  ).length;
  function changeLevel(value: AcademicLevelFilter) {
    setLevel(value);
    setQuery("");
  }
  const matches = (c: AcademicRosterRow) =>
    (c.number + " " + c.name).toLowerCase().includes(query.toLowerCase());
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await refreshRef.current();
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function readFile(file?: File) {
    const readVersion = ++importReadVersion.current;
    setImportRows([]);
    setImportFeedback(null);
    setError("");
    if (!file) return;
    try {
      if (file.size > 1000000) throw new Error("檔案上限 1 MB");
      const text = await file.text();
      if (readVersion !== importReadVersion.current) return;
      const rows = parseAcademicCSV(text, importLevel);
      if (
        rows.some((r) =>
          candidates.some(
            (c) => normalizeAcademicNumber(c.number) === r.number,
          ),
        )
      )
        throw new Error("名單含已存在的參賽編號；匯入不會覆蓋原名單");
      setImportRows(rows);
    } catch (e) {
      if (readVersion !== importReadVersion.current) return;
      setError((e as Error).message);
      setImportFeedback({ state: "error", message: (e as Error).message });
    }
  }
  async function confirmImport() {
    if (importPending.current || busy || !online || !importRows.length) return;
    importPending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const count = importRows.length;
    setImportFeedback({
      state: "pending",
      message: `正在匯入 ${count} 人，請稍候…`,
    });
    try {
      await importAcademic(importRows);
      setImportRows([]);
      setLevel(importLevel);
      setQuery("");
      const message = `已成功匯入 ${count} 人，尚未公布。`;
      setImportFeedback({ state: "success", message });
      setNotice(message);
      // A slow list refresh must not hide a successful import receipt.
      void refreshRef.current();
    } catch (e) {
      const message = academicImportError(e);
      setImportFeedback({ state: "error", message });
      setError(message);
    } finally {
      importPending.current = false;
      setBusy(false);
    }
  }
  async function save() {
    if (!selected) return;
    let value: number | null;
    try {
      value = scoreText.trim() ? academicScore(scoreText) : null;
      if (value === null && practical === null)
        throw new Error("請至少登錄學科或術科成績");
      if (
        (selected.score !== null || selected.practical_completed != null) &&
        !reason.trim()
      )
        throw new Error("請填寫修改原因");
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const signature = JSON.stringify([
      selected.id,
      selected.revision,
      value,
      practical,
      reason,
    ]);
    if (saveReceipt.current.signature !== signature)
      saveReceipt.current = { signature, id: crypto.randomUUID() };
    await run(async () => {
      await saveAcademic({
        id: selected.id,
        score: value,
        practical_completed: practical,
        reason,
        expected_revision: selected.revision,
        request_id: saveReceipt.current.id,
      });
      setSelected(null);
    }, "檢定成績已儲存，尚未新增至公開成績；請確認後統一公布。");
  }
  return (
    <div className="academic-theme academic-shell">
      {isDemoMode && (
        <div className="demo-bar">
          示範模式 · 姓名與成績皆為虛構，重整後重設，尚未連接正式賽事
        </div>
      )}
      <header className="site-header">
        <a className="brand" href="#/exam">
          <span className="brand-mark">
            <Bot />
          </span>
          <span>
            TTRA<span className="brand-caption">2026 EXAMINATION</span>
          </span>
        </a>
        <EventNavigation section="exam" staffView={staffView} />
      </header>
      <main className="page academic-page">
        <section className="page-intro">
          <div>
            <p className="eyebrow">2026 TTRA 機器人實作技能檢定</p>
            <h1>{staffView ? "檢定成績工作台" : "檢定成績"}</h1>
            <p className="muted">
              學科 80 分（含）以上＋術科完成即通過，由評審統一公布
            </p>
          </div>
          <Button
            variant="outline"
            disabled={loading || busy}
            onClick={() => void refreshRef.current()}
          >
            <RefreshCw />
            更新
          </Button>
        </section>
        {!online && (
          <p className="notice">
            網路中斷：目前為上次取得的資料，無法登分或公布。
          </p>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {refreshError && (
          <p role="alert" className="error-message">
            {refreshError}
          </p>
        )}
        {notice && (
          <p role="status" className="success-message">
            {notice}
          </p>
        )}
        {staffView && !canGrade ? (
          <section className="panel auth-panel">
            {authLoading ? (
              <p>正在確認權限…</p>
            ) : !session ? (
              <Login />
            ) : (
              <>
                <ShieldCheck />
                <h2>尚未取得學科操作權限</h2>
                <p>
                  請主辦人授予學科評審權限；挑戰賽裁判不會自動取得學科權限。
                </p>
                <Button
                  variant="outline"
                  onClick={() =>
                    void supabase!.auth.signOut({ scope: "local" })
                  }
                >
                  登出
                </Button>
              </>
            )}
          </section>
        ) : staffView ? (
          <>
            <section className="academic-summary">
              <div>
                <span>{academicLevelName(level)}參賽者</span>
                <strong>{levelCandidates.length} 人</strong>
              </div>
              <div>
                <span>已登學科</span>
                <strong>{levelGraded} 人</strong>
              </div>
              <div>
                <span>未登學科</span>
                <strong>{levelCandidates.length - levelGraded} 人</strong>
              </div>
              <div>
                <span>已公開</span>
                <strong>
                  {
                    levelCandidates.filter((c) => c.published_score !== null)
                      .length
                  }{" "}
                  人
                </strong>
              </div>
            </section>
            <section className="panel publication-panel">
              <div>
                <h2>手動統一公布</h2>
                <p className="muted">
                  {workspace?.publishedAt
                    ? "最近公布：" +
                      new Date(workspace.publishedAt).toLocaleString("zh-TW")
                    : "尚未公布任何檢定成績"}
                </p>
              </div>
              <Button
                className="primary-action"
                disabled={!online || busy || loading || !graded || !workspace}
                onClick={() =>
                  setPublishConfirmation({
                    version: workspace!.version,
                    count: graded,
                    missing: candidates.length - graded,
                    requestId: crypto.randomUUID(),
                  })
                }
              >
                公布全部檢定成績
              </Button>
            </section>
            <AcademicLevelTabs
              value={level}
              onChange={changeLevel}
              includeUnassigned={unknownCount > 0}
            />
            {unknownCount > 0 && (
              <p className="notice">
                有 {unknownCount}{" "}
                位既有參賽者的編號不在指定範圍，已保留於「待確認等級」，沒有更改編號或分數。
              </p>
            )}
            <section className="panel">
              <div className="panel-heading">
                <h2>{academicLevelName(level)} · 檢定登分名單</h2>
                {!isDemoMode && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void supabase!.auth.signOut({ scope: "local" })
                    }
                  >
                    登出
                  </Button>
                )}
              </div>
              <div className="toolbar">
                <Input
                  aria-label="搜尋學科參賽者"
                  placeholder="搜尋姓名或參賽編號"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {loading ? (
                <p className="empty-state">正在取得名單…</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>操作</TableHead>
                      <TableHead>參賽編號</TableHead>
                      <TableHead>姓名</TableHead>
                      <TableHead>學科（內部）</TableHead>
                      <TableHead>術科</TableHead>
                      <TableHead>檢定結果／公告</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {levelCandidates.filter(matches).map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <Button
                            variant="outline"
                            disabled={busy || !online}
                            onClick={() => {
                              setSelected(c);
                              setScoreText(
                                c.score === null ? "" : String(c.score),
                              );
                              setPractical(c.practical_completed ?? null);
                              setReason("");
                              setError("");
                            }}
                          >
                            {c.score === null && c.practical_completed == null
                              ? "登分"
                              : "修改"}
                          </Button>
                        </TableCell>
                        <TableCell>{c.number}</TableCell>
                        <TableCell>{c.name}</TableCell>
                        <TableCell>
                          {c.score === null ? "尚未登錄" : c.score + " 分"}
                          {(c.score !== c.published_score ||
                            (c.practical_completed ?? null) !==
                              (c.published_practical_completed ?? null)) &&
                            c.score !== null && (
                              <span className="academic-draft">待公布</span>
                            )}
                        </TableCell>
                        <TableCell>
                          {practicalLabel(c.practical_completed)}
                        </TableCell>
                        <TableCell>
                          <strong>
                            {examOutcome(c.score, c.practical_completed)}
                          </strong>
                          <div className="hint">
                            {c.published_score === null
                              ? "尚未公布"
                              : `已公布：${examOutcome(c.published_score, c.published_practical_completed)}`}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {!loading && !levelCandidates.filter(matches).length && (
                <p className="empty-state">沒有符合的參賽者。</p>
              )}
            </section>
            {canImport && (
              <section className="panel form-panel">
                <div className="panel-heading">
                  <h2>匯入學科名單</h2>
                  <Button
                    variant="outline"
                    onClick={() =>
                      downloadCSV(
                        `TTRA-${academicLevelName(importLevel)}-名單範本.csv`,
                        academicRosterTemplate(importLevel),
                      )
                    }
                  >
                    <Download />
                    下載範本
                  </Button>
                </div>
                <div className="form-body">
                  <AcademicLevelTabs
                    value={importLevel}
                    disabled={busy}
                    onChange={(value) => {
                      if (value === "unassigned") return;
                      importReadVersion.current += 1;
                      setImportLevel(value);
                      setImportRows([]);
                      setImportFeedback(null);
                    }}
                  />
                  <p className="hint">
                    編號範圍：
                    {
                      academicLevels.find((item) => item.id === importLevel)!
                        .first
                    }
                    ～
                    {
                      academicLevels.find((item) => item.id === importLevel)!
                        .last
                    }
                    。等級依編號辨識，不必增加 CSV 欄位。
                  </p>
                  <p className="hint">
                    使用 UTF-8
                    CSV，每列一位參賽者，只保留參賽編號、姓名。與挑戰賽名單分開管理。範本姓名為虛構；公布後只顯示遮罩姓名與結果，不公開學科實際分數。
                  </p>
                  <label className="field">
                    <span>學科名單 CSV</span>
                    <Input
                      key={importLevel}
                      type="file"
                      accept=".csv,text/csv"
                      disabled={busy || !online}
                      onChange={(e) => void readFile(e.target.files?.[0])}
                    />
                  </label>
                  {importRows.length > 0 && (
                    <>
                      <p>
                        {academicLevelName(importLevel)} · 預覽{" "}
                        {importRows.length} 人；只新增，不覆蓋原名單。
                      </p>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>參賽編號</TableHead>
                            <TableHead>姓名</TableHead>
                            <TableHead>等級</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {importRows.map((r) => (
                            <TableRow key={r.number}>
                              <TableCell>{r.number}</TableCell>
                              <TableCell>{r.name}</TableCell>
                              <TableCell>
                                {academicLevelName(academicLevel(r.number))}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <Button
                        type="button"
                        disabled={busy || !online}
                        aria-busy={importFeedback?.state === "pending"}
                        onClick={() => void confirmImport()}
                      >
                        <Upload />
                        {importFeedback?.state === "pending"
                          ? `正在匯入 ${importRows.length} 人…`
                          : `確認匯入 ${importRows.length} 人`}
                      </Button>
                    </>
                  )}
                  {importFeedback && (
                    <p
                      role={
                        importFeedback.state === "error" ? "alert" : "status"
                      }
                      className={
                        importFeedback.state === "error"
                          ? "error-message"
                          : importFeedback.state === "success"
                            ? "success-message"
                            : "notice"
                      }
                    >
                      {importFeedback.message}
                    </p>
                  )}
                  {!online && (
                    <p className="error-message">
                      目前沒有網路連線，連線恢復後才能匯入。
                    </p>
                  )}
                </div>
              </section>
            )}
            <section className="panel academic-audit">
              <div className="panel-heading">
                <h2>登分與公布紀錄</h2>
                <span>最近 10 筆</span>
              </div>
              {!workspace?.audit.length && (
                <p className="empty-state">尚無紀錄</p>
              )}
              {workspace?.audit.slice(0, 10).map((a) => (
                <details className="audit-row" key={a.id}>
                  <summary>
                    <strong>{a.number || "全部檢定成績"}</strong>
                    <span>
                      {(
                        {
                          import: "名單匯入",
                          score: "成績登錄／更正",
                          publish: "統一公布",
                        } as Record<string, string>
                      )[a.action] || a.action}
                    </span>
                    <time>
                      {new Date(a.created_at).toLocaleString("zh-TW")}
                    </time>
                  </summary>
                  <p>
                    {a.actor_id} · {a.reason || "首次登錄／公布"}
                  </p>
                  <pre>
                    {JSON.stringify(
                      { 修改前: a.old_value, 修改後: a.new_value },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              ))}
            </section>
          </>
        ) : (
          <section className="panel">
            <AcademicLevelTabs
              value={level}
              onChange={changeLevel}
              includeUnassigned={Boolean(
                publicData?.results.some(
                  (r) => academicLevel(r.number) === null,
                ),
              )}
            />
            <div className="panel-heading">
              <h2>{academicLevelName(level)} · 檢定成績公告</h2>
              <span>{publicData?.publishedAt ? "已公布" : "待公布"}</span>
            </div>
            {loading ? (
              <p className="empty-state">正在取得成績…</p>
            ) : !publicData?.publishedAt ? (
              <div className="empty-state">
                <ShieldCheck />
                <h2>成績尚未公布</h2>
                <p>
                  預計 10/04（日）10:00 公布，實際時間依批改進度及評審確認為準。
                </p>
                <p>公布後本頁會自動更新。</p>
              </div>
            ) : (
              <>
                <p className="rules-note">
                  公布時間：
                  {new Date(publicData.publishedAt).toLocaleString("zh-TW")} ·
                  本等級共 {levelResults.length}{" "}
                  人。尚未列出者可能仍未完成登分。
                </p>
                <div className="toolbar">
                  <Input
                    aria-label="搜尋學科成績"
                    placeholder="搜尋姓名或參賽編號"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>參賽編號</TableHead>
                      <TableHead>姓名</TableHead>
                      <TableHead>檢定成績</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {levelResults.filter(matches).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.number}</TableCell>
                        <TableCell>{r.name}</TableCell>
                        <TableCell>
                          <strong
                            className={`exam-outcome ${r.overall_passed === null ? "pending" : r.overall_passed ? "passed" : "failed"}`}
                          >
                            {r.overall_passed === null
                              ? "待確認"
                              : r.overall_passed
                                ? "通過"
                                : "未通過"}
                          </strong>
                          <div className="hint">
                            學科：{r.passed ? "合格" : "不合格"}
                          </div>
                          <div className="hint">
                            術科：{practicalLabel(r.practical_completed)}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {!levelResults.filter(matches).length && (
                  <p className="empty-state">沒有符合的已公布成績。</p>
                )}
              </>
            )}
          </section>
        )}
        <footer>
          <span>台灣青少年機器人協會 TTRA</span>
          <span>
            {isDemoMode ? "示範內容，非正式成績" : "學科成績以大會最終核定為準"}
          </span>
        </footer>
      </main>
      <Dialog
        open={Boolean(selected) && staffView && canGrade}
        onOpenChange={(open) => {
          if (!open && !busy) setSelected(null);
        }}
      >
        <DialogContent className="academic-theme academic-dialog">
          <DialogTitle>
            {selected?.number} · {selected?.name}
          </DialogTitle>
          <DialogDescription>
            {selected && academicLevelName(academicLevel(selected.number))}。
            儲存只更新內部成績，不會立即公開。已有分數的更正需填寫原因。
          </DialogDescription>
          <label className="field">
            <span>學科成績（0–100 分）</span>
            <Input
              type="number"
              min={0}
              max={100}
              step={0.1}
              aria-label="學科成績"
              value={scoreText}
              disabled={busy}
              onChange={(e) => setScoreText(e.target.value)}
            />
          </label>
          <fieldset className="practical-field">
            <legend>術科成績</legend>
            <div className="practical-options">
              <Button
                type="button"
                variant="outline"
                aria-pressed={practical === true}
                disabled={busy}
                onClick={() => setPractical(true)}
              >
                完成
              </Button>
              <Button
                type="button"
                variant="outline"
                aria-pressed={practical === false}
                disabled={busy}
                onClick={() => setPractical(false)}
              >
                未完成
              </Button>
            </div>
            <p className="hint">
              {practical === null
                ? "尚未登錄，可先儲存檢定成績。"
                : `已選擇：${practicalLabel(practical)}`}
            </p>
          </fieldset>
          <p className="hint">
            學科 80
            分（含）以上且術科完成，檢定才通過。學科空白可先儲存術科，尚未登錄不視為
            0 分。
          </p>
          <label className="field">
            <span>
              修改原因
              {selected &&
              (selected.score !== null || selected.practical_completed != null)
                ? "（必填）"
                : "（選填）"}
            </span>
            <Textarea
              aria-label="學科修改原因"
              maxLength={1000}
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <Button disabled={busy || !online} onClick={() => void save()}>
            {busy ? "儲存中…" : "儲存檢定成績"}
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(publishConfirmation) && staffView && canGrade}
        onOpenChange={(open) => {
          if (!open && !busy) setPublishConfirmation(null);
        }}
      >
        <DialogContent className="academic-theme academic-dialog">
          <DialogTitle>確認一次公布全部已登錄成績？</DialogTitle>
          <DialogDescription>
            本次包含全部等級，不受畫面篩選影響。 將公開{" "}
            {publishConfirmation?.count}{" "}
            人的遮罩姓名、學科合格狀態、術科與檢定結果，不公開實際分數。尚有{" "}
            {publishConfirmation?.missing}{" "}
            人未登錄學科，本次不列入公告。已登學科但未登術科者顯示「待確認」。
          </DialogDescription>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <Button
            disabled={busy || !online}
            onClick={() => {
              if (publishConfirmation)
                void run(async () => {
                  await publishAcademic(
                    publishConfirmation.version,
                    publishConfirmation.requestId,
                  );
                  setPublishConfirmation(null);
                }, "本次檢定成績已統一公布。");
            }}
          >
            {busy ? "公布中…" : "確認公布"}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setPublishConfirmation(null)}
          >
            返回核對
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
export function AcademicLevelTabs({
  value,
  onChange,
  includeUnassigned = false,
  disabled = false,
}: {
  value: AcademicLevelFilter;
  onChange: (value: AcademicLevelFilter) => void;
  includeUnassigned?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="academic-level-tabs" role="group" aria-label="檢定等級">
      {academicLevels.map((item) => (
        <Button
          key={item.id}
          variant={value === item.id ? "default" : "outline"}
          aria-pressed={value === item.id}
          disabled={disabled}
          onClick={() => onChange(item.id)}
        >
          {item.name}
        </Button>
      ))}
      {includeUnassigned && (
        <Button
          variant={value === "unassigned" ? "default" : "outline"}
          aria-pressed={value === "unassigned"}
          disabled={disabled}
          onClick={() => onChange("unassigned")}
        >
          待確認等級
        </Button>
      )}
    </div>
  );
}
