import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "./supabase";
import { academicRequest } from "./academic-request";
import {
  categories,
  heatNumbers,
  type CategoryId,
  type Team,
  type CheckinStatus,
} from "./domain";
import { CheckCircle2 } from "./icons";
import { awardLabel } from "./award-display";

async function rpc<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!supabase) throw new Error("正式連線尚未設定");
  const { data, error } = await academicRequest((signal) =>
    supabase!.rpc(name, args).abortSignal(signal),
  );
  if (error) throw error;
  return data as T;
}
type Claim = { team_id: string; claimed: boolean; revision: number };
export function scoreActionLabel(
  checkedIn: boolean,
  count: number,
  total: number,
) {
  if (!checkedIn) return "未報到";
  if (count >= total) return "查看／修改";
  return count > 0 ? "繼續計分" : "計分";
}

export function StaffCheckin({
  team,
  disabled,
  busy,
  hasAttempts,
  onChange,
}: {
  team: Team;
  disabled: boolean;
  busy: boolean;
  hasAttempts: boolean;
  onChange: (status: CheckinStatus) => void;
}) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const checkedIn = team.checkinStatus === "checked_in";
  const locked = disabled || busy || (checkedIn && hasAttempts);
  return (
    <div className="staff-checkin">
      <Button
        variant="outline"
        className={checkedIn ? "is-checked-in" : "needs-checkin"}
        disabled={locked}
        aria-label={`${team.number} ${team.name} ${checkedIn ? "已報到" : "標記已報到"}`}
        title={
          checkedIn
            ? hasAttempts
              ? "已有成績，不可取消報到"
              : "點選可取消報到"
            : "標記已報到"
        }
        onClick={() => {
          if (!locked) {
            if (checkedIn) setConfirmCancel(true);
            else onChange("checked_in");
          }
        }}
      >
        {checkedIn && <CheckCircle2 size={17} aria-hidden="true" />}
        {busy ? "儲存中…" : checkedIn ? "已報到" : "標記已報到"}
      </Button>
      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent>
          <DialogTitle>取消報到？</DialogTitle>
          <DialogDescription>
            {team.number} {team.name} 將恢復為尚未報到，報到時間也會清除。
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCancel(false)}>
              保留報到
            </Button>
            <Button
              variant="destructive"
              disabled={locked || !checkedIn}
              onClick={() => {
                if (locked || !checkedIn) return;
                setConfirmCancel(false);
                onChange("pending");
              }}
            >
              確認取消報到
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
export function useDrinkClaims(accessKey: string | null) {
  const [claims, setClaims] = useState<Record<string, Claim>>({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const generation = useRef(0);
  const locks = useRef(new Set<string>());
  const refresh = useCallback(async () => {
    if (!accessKey) return;
    const current = generation.current;
    try {
      const values = await rpc<Claim[]>("get_drink_claims");
      if (current !== generation.current) return;
      setClaims((old) => {
        const next = { ...old };
        for (const claim of values)
          if (
            !next[claim.team_id] ||
            next[claim.team_id].revision <= claim.revision
          )
            next[claim.team_id] = claim;
        return next;
      });
      setReady(true);
      setError("");
    } catch (e) {
      if (current === generation.current)
        setError("飲料紀錄同步失敗：" + (e as Error).message);
    }
  }, [accessKey]);
  useEffect(() => {
    generation.current += 1;
    setClaims({});
    setReady(false);
    setError("");
    setBusy({});
    setRowErrors({});
    locks.current.clear();
    if (!accessKey) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => {
      generation.current += 1;
      clearInterval(timer);
    };
  }, [accessKey, refresh]);
  async function change(teamId: string, claimed: boolean) {
    if (!accessKey || !ready || locks.current.has(teamId)) return;
    const current = generation.current;
    locks.current.add(teamId);
    setBusy((v) => ({ ...v, [teamId]: true }));
    setRowErrors((v) => ({ ...v, [teamId]: "" }));
    try {
      const saved = await rpc<Claim>("set_drink_claim", {
        p_team_id: teamId,
        p_claimed: claimed,
        p_expected_revision: claims[teamId]?.revision ?? 0,
      });
      if (current === generation.current)
        setClaims((v) => ({
          ...v,
          [teamId]:
            !v[teamId] || saved.revision >= v[teamId].revision
              ? saved
              : v[teamId],
        }));
    } catch (e) {
      if (current === generation.current) {
        setRowErrors((v) => ({
          ...v,
          [teamId]: "未確認儲存結果，請核對後重試：" + (e as Error).message,
        }));
        await refresh();
      }
    } finally {
      if (current === generation.current) {
        locks.current.delete(teamId);
        setBusy((v) => ({ ...v, [teamId]: false }));
      }
    }
  }
  return { claims, ready, error, busy, rowErrors, change, refresh };
}
export function DrinkControl({
  team,
  state,
  disabled,
}: {
  team: Team;
  state: ReturnType<typeof useDrinkClaims>;
  disabled: boolean;
}) {
  return (
    <div className="drink-control">
      <label>
        <input
          type="checkbox"
          aria-label={`${team.number} ${team.name} 飲料已領取`}
          checked={state.claims[team.id]?.claimed ?? false}
          disabled={disabled || !state.ready || state.busy[team.id]}
          onChange={(e) => void state.change(team.id, e.target.checked)}
        />
        <span>飲料已領取</span>
      </label>
      {state.busy[team.id] && <small role="status">儲存中…</small>}
      {state.rowErrors[team.id] && (
        <small className="error-message" role="alert">
          {state.rowErrors[team.id]}
        </small>
      )}
    </div>
  );
}

type Setting = {
  category_id: CategoryId;
  heat: number;
  quota: number | null;
  merit_quota: number;
  entrant_count: number;
  top_half_count: number;
  revision: number;
  published_at: string | null;
};
type AwardPreview = {
  version: number;
  settings_revision: number;
  quota: number;
  merit_quota: number;
  boundary_conflict?: boolean;
  groups?: {
    category_id: CategoryId;
    heat: number;
    quota: number;
    merit_quota: number;
    boundary_conflict: boolean;
    entries: AwardPreview["entries"];
  }[];
  entries: {
    category_id?: CategoryId;
    heat?: number;
    team_id: string;
    number: string;
    name: string;
    rank: number;
    award_type: "rank" | "merit";
    primary_score: number;
    secondary_score: number | null;
    qualified: boolean;
    complete: boolean;
  }[];
};
export function AwardPanel({
  categoryId,
  disabled,
  onPublished,
}: {
  categoryId: CategoryId;
  disabled: boolean;
  onPublished: () => Promise<void>;
}) {
  const [heat, setHeat] = useState(1);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<AwardPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const requestId = useRef("");
  const blockedPreview =
    !preview?.entries.length ||
    (preview.groups ?? [preview]).some(
      (g) => !g.entries.length || g.boundary_conflict,
    );
  const setting = settings.find(
    (s) => s.category_id === categoryId && s.heat === heat,
  );
  const reload = useCallback(
    async () => setSettings(await rpc<Setting[]>("get_award_settings")),
    [],
  );
  useEffect(() => {
    let live = true;
    void rpc<Setting[]>("get_award_settings")
      .then((v) => {
        if (live) setSettings(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    setPreview(null);
    setConfirmed(false);
    setMessage("");
  }, [setting?.quota, setting?.merit_quota, setting?.revision, heat]);
  async function action(operation: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await operation();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (categoryId === "preschool")
    return (
      <section className="panel form-body">
        <h2>幼兒組不排名</h2>
        <p>本組只顯示進球數與挑戰狀態，不公告獎狀名次。</p>
      </section>
    );
  return (
    <section className="panel form-panel">
      <div className="panel-heading">
        <div>
          <h2>官方名次與佳作公告</h2>
          <p className="muted">
            {categories.find((c) => c.id === categoryId)?.name} · 各梯次獨立排名
          </p>
        </div>
      </div>
      <div className="form-body">
        <p>
          瓶數、秒數照常即時公開。名次與佳作經確認公布後才顯示在家長端，不會隨登分自動變動。
        </p>
        <div className="field-grid">
          <label className="field">
            <span>公告梯次</span>
            <NativeSelect
              aria-label="公告梯次"
              value={heat}
              disabled={busy}
              onChange={(e) => {
                setHeat(Number(e.target.value));
                setError("");
              }}
            >
              {heatNumbers(categoryId).map((n) => (
                <option value={n} key={n}>
                  第 {n} 梯
                </option>
              ))}
            </NativeSelect>
          </label>
          <div className="field">
            <span>名次名額</span>
            <strong>每梯次前 3 名</strong>
          </div>
          <div className="field">
            <span>佳作名額</span>
            <strong>
              {setting?.entrant_count == null
                ? "載入中…"
                : `${setting.merit_quota} 人（自動計算）`}
            </strong>
          </div>
        </div>
        <p className="hint">
          依本梯次全部名單人數取前 50%（小數進位），排除前三名後為佳作。
          {setting?.entrant_count != null &&
            `本梯 ${setting.entrant_count} 人，前 50% 為 ${setting.top_half_count} 人，佳作 ${setting.merit_quota} 人。`}
          同分跨越名次／佳作或得獎分界時，暫停公布，請先取得主辦單位裁定。
        </p>
        <p>
          {setting?.published_at
            ? `本梯已公告：${new Date(setting.published_at).toLocaleString("zh-TW")}；更正後需再次預覽公布。`
            : "本梯尚未公告名次"}
        </p>
        <div className="award-actions">
          <Button
            variant="outline"
            disabled={disabled || busy}
            onClick={() => void action(reload)}
          >
            重新載入
          </Button>
          <Button
            disabled={disabled || busy || setting?.entrant_count == null}
            onClick={() =>
              void action(async () => {
                const data = await rpc<AwardPreview>("preview_awards", {
                  p_category: categoryId,
                  p_heat: heat,
                });
                setPreview(data);
                setConfirmed(false);
                requestId.current = crypto.randomUUID();
              })
            }
          >
            預覽公告名單
          </Button>
          <Button
            variant="outline"
            disabled={disabled || busy || setting?.entrant_count == null}
            onClick={() =>
              void action(async () => {
                const all = await rpc<{
                  version: number;
                  groups: NonNullable<AwardPreview["groups"]>;
                }>("preview_all_awards");
                setPreview({
                  version: all.version,
                  settings_revision: 0,
                  quota: all.groups.reduce((sum, g) => sum + g.quota, 0),
                  merit_quota: all.groups.reduce(
                    (sum, g) => sum + g.merit_quota,
                    0,
                  ),
                  groups: all.groups,
                  entries: all.groups.flatMap((g) =>
                    g.entries.map((e) => ({
                      ...e,
                      category_id: g.category_id,
                      heat: g.heat,
                    })),
                  ),
                });
                setConfirmed(false);
                requestId.current = crypto.randomUUID();
              })
            }
          >
            預覽全賽事統一公告
          </Button>
        </div>
        <p className="hint">
          統一公告會依最新名單與成績重新計算所有排名梯次的得獎者；幼兒不列入。
        </p>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="success-message" role="status">
            {message}
          </p>
        )}
      </div>
      <Dialog
        open={Boolean(preview)}
        onOpenChange={(v) => {
          if (!v && !busy) setPreview(null);
        }}
      >
        <DialogContent className="award-dialog">
          <DialogTitle>
            {preview?.groups
              ? "確認全賽事統一公告"
              : `確認第 ${heat} 梯名次與佳作`}
          </DialogTitle>
          <DialogDescription>
            請確認官方已核定兩種名額、同名次及合格資格。按公布後，家長就會看到以下名次或佳作。
          </DialogDescription>
          <p>
            名次名額 {preview?.quota} 人 · 佳作名額 {preview?.merit_quota} 人 ·
            本次公告 {preview?.entries.length} 人
          </p>
          {preview?.groups?.map((g) => (
            <small key={`${g.category_id}-${g.heat}`}>
              {categories.find((c) => c.id === g.category_id)?.name} · 第{" "}
              {g.heat} 梯：名次 {g.quota} 人、佳作 {g.merit_quota} 人，公告{" "}
              {g.entries.length} 人
            </small>
          ))}
          <div className="award-preview">
            {preview?.entries.map((entry) => (
              <div key={entry.team_id}>
                <strong>
                  {awardLabel(entry)} · {entry.number} {entry.name}
                </strong>
                <span>
                  {entry.primary_score}{" "}
                  {(entry.category_id ?? categoryId) === "program"
                    ? "秒"
                    : (entry.category_id ?? categoryId) === "power"
                      ? "瓶"
                      : "分"}
                  {entry.secondary_score !== null
                    ? ` · ${entry.secondary_score} ${(entry.category_id ?? categoryId) === "program" ? "g" : "秒"}`
                    : ""}
                  {!entry.qualified && " · 未達合格標準（請核對獎狀資格）"}
                  {!entry.complete && " · 尚有回合未登錄"}
                </span>
              </div>
            ))}
          </div>
          {preview &&
            (preview.groups ?? [preview]).some((g) => g.boundary_conflict) && (
              <p role="alert" className="error-message">
                同名次跨越名次／佳作或得獎名額分界，請先由官方確認名額後再公布。
              </p>
            )}
          {preview &&
            (preview.groups ?? [preview]).some((g) => !g.entries.length) && (
              <p>有梯次尚無可公布的有效成績，不能公告。</p>
            )}
          <label className="award-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            已取得官方確認，以上名次、佳作及獎狀資格正確
          </label>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              返回檢查
            </Button>
            <Button
              disabled={disabled || busy || !confirmed || blockedPreview}
              onClick={() =>
                void action(async () => {
                  if (preview!.groups)
                    await rpc("publish_all_awards", {
                      p_version: preview!.version,
                      p_request_id: requestId.current,
                    });
                  else
                    await rpc("publish_awards", {
                      p_category: categoryId,
                      p_heat: heat,
                      p_version: preview!.version,
                      p_settings_revision: preview!.settings_revision,
                      p_request_id: requestId.current,
                    });
                  setPreview(null);
                  await reload();
                  await onPublished();
                  setMessage("名次與佳作已公告。");
                })
              }
            >
              {busy
                ? "處理中…"
                : preview?.groups
                  ? "確認統一公布名次與佳作"
                  : "確認公布本梯名次與佳作"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
