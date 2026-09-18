import { useRef, useState } from "react";
import { Check, Save, AlertTriangle } from "./icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  categories,
  creativeScore,
  slotOptions,
  validateScore,
  normalizeScore,
  failureReasons,
  type Team,
  type Attempt,
  type AttemptStatus,
} from "./domain";
import type { SaveInput } from "./data";
import {
  bothConfirmed,
  confirmScore,
  emptyConfirmation,
  type ConfirmationRole,
  type ScoreConfirmation,
} from "./score-confirmation";
export function ScoreForm({
  team,
  attempts,
  onSave,
  disabled,
}: {
  team: Team;
  attempts: Attempt[];
  onSave: (v: SaveInput) => Promise<void>;
  disabled: boolean;
}) {
  const slots = slotOptions(team.categoryId);
  const [slot, setSlot] = useState(slots[0][0]);
  const existing = attempts.find(
    (a) => a.teamId === team.id && a.slotKey === slot,
  );
  const [data, setData] = useState<Record<string, number | string | boolean>>(
    existing?.data ?? initial(team.categoryId, attempts, team.id),
  );
  const [status, setStatus] = useState<AttemptStatus>(
    team.categoryId === "preschool"
      ? "valid"
      : existing?.status === "terminated"
        ? "invalid"
        : (existing?.status ?? "valid"),
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [confirmations, setConfirmations] = useState(emptyConfirmation);
  const confirmationsRef = useRef(emptyConfirmation());
  const submitting = useRef(false);
  const [success, setSuccess] = useState("");
  const expectedRevision = useRef(existing?.revision ?? (existing ? 1 : 0));
  const request = useRef<{ signature: string; id: string } | null>(null);
  function resetConfirmations(signature = "") {
    const next = emptyConfirmation(signature);
    confirmationsRef.current = next;
    setConfirmations(next);
  }
  function closeConfirmation() {
    if (submitting.current) return;
    setConfirm(false);
    resetConfirmations();
  }
  function selectSlot(value: string) {
    if (submitting.current) return;
    closeConfirmation();
    setSlot(value);
    const old = attempts.find(
      (a) => a.teamId === team.id && a.slotKey === value,
    );
    setData(old?.data ?? initial(team.categoryId, attempts, team.id));
    setStatus(
      team.categoryId === "preschool"
        ? "valid"
        : old?.status === "terminated"
          ? "invalid"
          : (old?.status ?? "valid"),
    );
    expectedRevision.current = old?.revision ?? (old ? 1 : 0);
    setReason("");
    setError("");
    setSuccess("");
    request.current = null;
  }
  function numeric(
    key: string,
    label: string,
    min: number,
    max: number | undefined,
    step = 1,
  ) {
    return (
      <label className="field" key={key}>
        <span>{label}</span>
        <Input
          aria-label={label}
          type="number"
          min={min}
          max={max}
          step={step}
          inputMode={step === 1 ? "numeric" : "decimal"}
          value={data[key] === undefined ? "" : String(data[key])}
          required={!(key === "seconds" && status === "invalid")}
          onChange={(e) => {
            setSuccess("");
            setData({
              ...data,
              [key]: e.target.value === "" ? "" : Number(e.target.value),
            });
          }}
        />
      </label>
    );
  }
  const validStatus = status !== "invalid";
  function prepare() {
    const e = validateScore(team.categoryId, status, data, reason);
    if (e) {
      setError(e);
      return;
    }
    if (existing && !reason.trim()) {
      setError("修改既有成績必須填寫原因");
      return;
    }
    setError("");
    resetConfirmations(scoreSignature());
    setConfirm(true);
  }
  function scoreSignature() {
    return JSON.stringify({
      team: team.id,
      slot,
      status,
      data: normalizeScore(status, data),
      reason,
      revision: expectedRevision.current,
    });
  }
  function confirmRole(role: ConfirmationRole) {
    if (disabled || submitting.current || !confirm) return;
    const signature = scoreSignature();
    const next = confirmScore(confirmationsRef.current, signature, role);
    confirmationsRef.current = next;
    setConfirmations(next);
    if (bothConfirmed(next, signature)) void submit(next);
  }
  async function submit(approval: ScoreConfirmation) {
    if (disabled || submitting.current || !confirm) return;
    if (!bothConfirmed(approval, scoreSignature())) {
      resetConfirmations(scoreSignature());
      setError("成績已變更，請裁判與選手重新確認");
      return;
    }
    const validation = validateScore(team.categoryId, status, data, reason);
    if (validation || (expectedRevision.current > 0 && !reason.trim())) {
      resetConfirmations();
      setError(validation || "修改既有成績必須填寫原因");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const clean = normalizeScore(status, data);
      const signature = JSON.stringify({
        team: team.id,
        slot,
        status,
        data: clean,
        reason:
          status === "invalid"
            ? `未完成：${data.failureReason}${reason.trim() ? "；更正／備註：" + reason.trim() : ""}`
            : reason,
        revision: expectedRevision.current,
      });
      if (request.current?.signature !== signature)
        request.current = { signature, id: crypto.randomUUID() };
      await onSave({
        teamId: team.id,
        categoryId: team.categoryId,
        slotKey: slot,
        attemptNo: slots.findIndex((s) => s[0] === slot) + 1,
        status,
        reason:
          status === "invalid"
            ? `未完成：${data.failureReason}${reason.trim() ? "；更正／備註：" + reason.trim() : ""}`
            : reason,
        data: clean,
        requestId: request.current.id,
        expectedRevision: expectedRevision.current,
        confirmations: { judge: true, participant: true },
      });
      expectedRevision.current += 1;
      setData(clean);
      setSuccess("成績已儲存並公開");
      setReason("");
      setConfirm(false);
      resetConfirmations();
      request.current = null;
    } catch (e) {
      setError((e as Error).message || "送出失敗，請重試；內容仍保留");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="panel form-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">
            {team.number} · 第 {team.heat} 梯 ·{" "}
            {categories.find((c) => c.id === team.categoryId)?.subtitle}
          </p>
          <h2>{team.name}</h2>
        </div>
        <span className="live-pill">裁判計分</span>
      </div>
      <div className="form-body">
        <div className="attempt-tabs">
          {slots.map(([key, label]) => (
            <Button
              key={key}
              variant={slot === key ? "default" : "outline"}
              onClick={() => selectSlot(key)}
            >
              {label}
              {attempts.some(
                (a) => a.teamId === team.id && a.slotKey === key,
              ) && <Check size={13} />}
            </Button>
          ))}
        </div>
        {team.categoryId !== "preschool" && (
          <label className="field">
            <span>回合狀態</span>
            <NativeSelect
              aria-label="回合狀態"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as AttemptStatus);
                if (team.categoryId === "program")
                  setData((d) => ({
                    ...d,
                    completed: e.target.value === "valid" ? 1 : 0,
                  }));
                setSuccess("");
              }}
            >
              <option value="valid">正常完成</option>
              <option value="invalid">未完成</option>
            </NativeSelect>
          </label>
        )}
        {status === "invalid" && (
          <label className="field">
            <span>未完成原因</span>
            <NativeSelect
              aria-label="未完成原因"
              value={String(data.failureReason ?? "")}
              onChange={(e) => {
                setData({ ...data, failureReason: e.target.value });
                setSuccess("");
              }}
            >
              <option value="" disabled>
                請選擇原因
              </option>
              {failureReasons[team.categoryId].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
        {
          <div className="field-grid">
            {team.categoryId === "preschool" && (
              <>
                {numeric("childGoals", "小朋友進球數", 0, 4)}
                {numeric("parentGoals", "家長進球數", 0, 2)}
              </>
            )}
            {team.categoryId === "power" && (
              <>
                {numeric("bottles", "載重瓶數", 0, 999)}
                {numeric(
                  "seconds",
                  validStatus ? "完成時間（秒）" : "實際秒數（可留空）",
                  validStatus ? 0.1 : 0,
                  validStatus ? 30 : undefined,
                  0.1,
                )}
              </>
            )}
            {team.categoryId === "program" && (
              <>
                {numeric(
                  "seconds",
                  validStatus ? "完成時間（秒）" : "實際秒數（可留空）",
                  validStatus ? 0.1 : 0,
                  validStatus ? 25 : undefined,
                  0.1,
                )}
                {numeric("weight", "車頭淨重（g，無板車）", 0.1, 100000, 0.1)}
              </>
            )}
            {team.categoryId === "creative" && (
              <>
                {numeric("regular", "普通瓶得分數量", 0, 8)}
                {numeric(
                  "seconds",
                  validStatus
                    ? "達到最終分數的耗時（秒）"
                    : "實際秒數（可留空）",
                  0,
                  validStatus ? 40 : undefined,
                  0.1,
                )}
                {["red", "blue"].map((color) => (
                  <label className="field" key={color}>
                    <span>{color === "red" ? "紅色" : "藍色"}特殊瓶</span>
                    <NativeSelect
                      aria-label={color === "red" ? "紅色特殊瓶" : "藍色特殊瓶"}
                      value={String(data[color] ?? "none")}
                      onChange={(e) =>
                        setData({ ...data, [color]: e.target.value })
                      }
                    >
                      <option value="none">未得分 · 0 分</option>
                      <option value="correct">正確區域 · 20 分</option>
                      <option value="wrong">錯誤區域 · 5 分</option>
                    </NativeSelect>
                  </label>
                ))}
              </>
            )}
          </div>
        }
        {status === "invalid" && (
          <p className="hint">
            仍保存本回合數據，但不列為有效最佳成績。未計時可留空，有計時則填實際秒數。
          </p>
        )}
        {team.categoryId === "creative" && validStatus && (
          <p className="hint">
            每次限時 40 秒，時間到保留當下得分並填入 40.0
            秒。車體掉出場地、零件脫落或翻覆請選「未完成」。
          </p>
        )}
        {team.categoryId === "creative" && validStatus && (
          <div className="calculated">
            本回合自動計分{" "}
            <strong>
              {creativeScore({ data } as Attempt)} <small>分</small>
            </strong>
          </div>
        )}
        {team.categoryId === "preschool" && validStatus && (
          <div className="calculated">
            本回合進球總數{" "}
            <strong>
              {Number(data.childGoals ?? 0) + Number(data.parentGoals ?? 0)}{" "}
              <small>球</small>
            </strong>
          </div>
        )}
        {team.categoryId === "program" && validStatus && (
          <p className="hint">
            正常完成代表已自主折返回到起點。25 秒內完成即合格，超過 25
            秒不列有效成績。重量應使用賽前同一次量測值。
          </p>
        )}
        {team.categoryId === "power" && validStatus && (
          <p className="hint">
            未完成回合仍保留數據，但不列為有效拉動／推動成績。
          </p>
        )}
        <label className="field">
          <span>{existing ? "修改原因（必填）" : "備註（選填）"}</span>
          <Textarea
            aria-label="原因"
            placeholder={
              existing ? "請說明修正原因" : "有其他需要說明的事項再填寫"
            }
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {existing && (
          <p className="hint">
            <AlertTriangle size={14} />{" "}
            此回合已有成績，修改會立即更新排名，舊版本將保留。
          </p>
        )}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {success && (
          <p className="success-message" role="status">
            {success}
          </p>
        )}
        <Button
          className="primary-action"
          disabled={disabled || busy}
          onClick={prepare}
        >
          <Save size={16} />
          {disabled ? "目前無法送出" : existing ? "核對修改成績" : "核對成績"}
        </Button>
      </div>
      <Dialog
        open={confirm}
        onOpenChange={(v) => {
          if (!v) closeConfirmation();
        }}
      >
        <DialogContent>
          <DialogTitle>裁判與選手確認成績</DialogTitle>
          <DialogDescription>
            {team.number} {team.name} · {slots.find((s) => s[0] === slot)?.[1]}
            。請雙方核對下方成績。兩個按鈕都確認後即送出，家長會立即看到本次成績。
          </DialogDescription>
          <div className="confirm-data">
            {status === "invalid" && (
              <p>未完成 · {String(data.failureReason ?? "")}</p>
            )}
            {Object.entries(data)
              .filter(([k]) => k !== "completed" && k !== "failureReason")
              .map(([k, v]) => (
                <div key={k}>
                  {
                    (
                      {
                        childGoals: "小朋友進球",
                        parentGoals: "家長進球",
                        bottles: "瓶數",
                        seconds: "秒數",
                        weight: "淨重 g",
                        regular: "普通瓶",
                        red: "紅瓶",
                        blue: "藍瓶",
                      } as Record<string, string>
                    )[k]
                  }
                  ：
                  {(
                    {
                      correct: "正確區域",
                      wrong: "錯誤區域",
                      none: "未得分",
                    } as Record<string, string>
                  )[String(v)] ?? (v === "" ? "未記錄" : String(v))}
                </div>
              ))}
          </div>
          <p className="hint">
            請由選手本人按下「選手確認」代替簽名，表示已核對本回合成績。返回修改後須由雙方重新確認。
          </p>
          <div className="score-confirmations">
            <Button
              variant={confirmations.judge ? "outline" : "default"}
              disabled={busy || disabled || confirmations.judge}
              aria-pressed={confirmations.judge}
              onClick={() => confirmRole("judge")}
            >
              {confirmations.judge ? (
                <>
                  <Check size={18} />
                  裁判已確認
                </>
              ) : (
                "裁判確認"
              )}
            </Button>
            <Button
              variant={confirmations.participant ? "outline" : "default"}
              disabled={busy || disabled || confirmations.participant}
              aria-pressed={confirmations.participant}
              onClick={() => confirmRole("participant")}
            >
              {confirmations.participant ? (
                <>
                  <Check size={18} />
                  選手已確認
                </>
              ) : (
                "選手確認"
              )}
            </Button>
          </div>
          <p className="hint" role="status" aria-live="polite">
            {busy
              ? "雙方已確認，正在送出…"
              : confirmations.judge && confirmations.participant
                ? "雙方已確認；若送出失敗，可重試或返回檢查。"
                : confirmations.judge
                  ? "等待選手確認"
                  : confirmations.participant
                    ? "等待裁判確認"
                    : "等待裁判與選手確認"}
          </p>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={closeConfirmation}
            >
              返回檢查
            </Button>
            {error && bothConfirmed(confirmations, scoreSignature()) && (
              <Button
                disabled={busy || disabled}
                onClick={() => void submit(confirmationsRef.current)}
              >
                重試送出
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
function initial(
  category: Team["categoryId"],
  attempts: Attempt[],
  teamId: string,
): Record<string, number | string | boolean> {
  if (category === "preschool") return { childGoals: 0, parentGoals: 0 };
  if (category === "power") return { bottles: 7, seconds: "" };
  if (category === "program")
    return {
      completed: 1,
      seconds: "",
      weight:
        attempts.find((a) => a.teamId === teamId && a.data.weight)?.data
          .weight ?? "",
    };
  return { regular: 0, red: "none", blue: "none", seconds: "" };
}
