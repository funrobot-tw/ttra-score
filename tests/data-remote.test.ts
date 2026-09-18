import { describe, it, expect, vi, beforeEach } from "vitest";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../src/supabase", () => ({ isDemoMode: false, supabase: { rpc } }));
import {
  invalidateScoreboard,
  loadData,
  mapAttempt,
  saveAttempt,
} from "../src/data";
beforeEach(() => {
  invalidateScoreboard();
  rpc.mockReset();
});
const response = (name: string, version = 1) => ({
  data: {
    version,
    teams: [
      {
        id: "1",
        team_number: "程A001",
        name,
        heat: 1,
        category_id: "program",
        checkin_status: "pending",
      },
    ],
    attempts: [],
    results: [],
    awards: [{ team_id: "1", rank: 1 }],
  },
  error: null,
});
describe("依登入身份隔離公開快照快取", () => {
  it("送分將裁判與選手確認隨同本回合內容送至後端", async () => {
    rpc.mockResolvedValueOnce({
      data: { score_data: { childGoals: 1, parentGoals: 0 } },
      error: null,
    });
    await saveAttempt({
      teamId: "child",
      categoryId: "preschool",
      slotKey: "round-1",
      attemptNo: 1,
      status: "valid",
      reason: "",
      data: { childGoals: 1, parentGoals: 0 },
      requestId: "request",
      expectedRevision: 0,
      confirmations: { judge: true, participant: true },
    });
    expect(rpc).toHaveBeenCalledWith("submit_attempt", {
      p_input: expect.objectContaining({
        confirmations: { judge: true, participant: true },
        team_id: "child",
        expected_revision: 0,
      }),
    });
  });
  it("登入身份改變，即使分數版本相同也重新取資料", async () => {
    rpc.mockResolvedValueOnce(response("王小明"));
    expect((await loadData()).teams[0].name).toBe("王小明");
    invalidateScoreboard();
    rpc.mockResolvedValueOnce(response("王o明"));
    const publicData = await loadData();
    expect(publicData.teams[0].name).toBe("王o明");
    expect(publicData.awards).toEqual([{ team_id: "1", rank: 1 }]);
    expect(rpc.mock.calls[1][1]).toEqual({ p_version: -1 });
  });
  it("跨登出的舊請求不可覆蓋新匿名快照", async () => {
    let resolveOld!: (value: ReturnType<typeof response>) => void;
    rpc.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    const oldRequest = loadData();
    invalidateScoreboard();
    rpc.mockResolvedValueOnce(response("王o明"));
    await loadData();
    rpc.mockResolvedValue({
      data: { version: 1, unchanged: true },
      error: null,
    });
    resolveOld(response("王小明"));
    expect((await oldRequest).teams[0].name).toBe("王o明");
    expect((await loadData()).teams[0].name).toBe("王o明");
  });
  it("未完成資料與原因從後端還原，不刪除紀錄值", () => {
    const data = { bottles: 8, seconds: 55, failureReason: "超過邊界" };
    expect(mapAttempt({ score_data: data, status: "invalid" })).toMatchObject({
      status: "invalid",
      data,
      failureReason: "超過邊界",
    });
  });
});
