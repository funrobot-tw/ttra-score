import React from "react";
import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi, afterEach } from "vitest";
import App, { Login, ParticipantName, checkinTime } from "../src/App";
import { ScoreForm } from "../src/ScoreForm";
import { ImportPanel } from "../src/ImportPanel";
import { categories, type Team } from "../src/domain";
import AcademicApp, { AcademicLevelTabs } from "../src/AcademicApp";
import { CategoryTabs } from "../src/CategoryTabs";
import {
  AwardPanel,
  StaffCheckin,
  scoreActionLabel,
} from "../src/ChallengeStaffTools";

afterEach(() => vi.unstubAllGlobals());
describe("非瀏覽器渲染檢查", () => {
  it("家長報到時間使用台灣24小時制，缺少時間不補造", () => {
    expect(checkinTime("2026-09-09T07:01:00Z", true)).toBe("15:01");
    expect(checkinTime("2026-09-08T16:00:00Z", true)).toBe("00:00");
    expect(checkinTime(null, true)).toBe("");
    expect(checkinTime("invalid", true)).toBe("");
  });
  it("裁判計分按鈕依回合進度顯示操作", () => {
    expect(scoreActionLabel(false, 0, 2)).toBe("未報到");
    expect(scoreActionLabel(true, 0, 2)).toBe("計分");
    expect(scoreActionLabel(true, 1, 2)).toBe("繼續計分");
    expect(scoreActionLabel(true, 2, 2)).toBe("查看／修改");
    expect(scoreActionLabel(true, 2, 4)).toBe("繼續計分");
    expect(scoreActionLabel(true, 4, 4)).toBe("查看／修改");
  });
  it("報到採直接按鈕，已有成績及儲存中不可操作", () => {
    const team: Team = {
      id: "test",
      name: "王小明",
      number: "機A001",
      categoryId: "creative",
      heat: 1,
      checkinStatus: "pending",
      checkedInAt: null,
    };
    const render = (
      checkedIn: boolean,
      hasAttempts: boolean,
      busy = false,
      disabled = false,
    ) =>
      renderToString(
        <StaffCheckin
          team={{
            ...team,
            checkinStatus: checkedIn ? "checked_in" : "pending",
          }}
          hasAttempts={hasAttempts}
          busy={busy}
          disabled={disabled}
          onChange={() => {}}
        />,
      );
    expect(render(false, false)).toContain("標記已報到");
    expect(render(false, false)).not.toContain("<select");
    expect(render(false, false)).not.toContain('disabled=""');
    expect(render(true, false)).not.toContain('disabled=""');
    expect(render(true, true)).toContain('disabled=""');
    expect(render(true, true)).toContain("已有成績，不可取消報到");
    expect(render(false, false, true)).toContain("儲存中…");
    expect(render(false, false, true)).toContain('disabled=""');
    expect(render(false, false, false, true)).toContain('disabled=""');
  });
  it("已公布名次與佳作放在姓名右側，未得獎者不留空位", () => {
    for (const [award, label] of [
      [{ rank: 1, award_type: "rank" }, "第 1 名"],
      [{ rank: null, award_type: "merit" }, "佳作"],
    ] as const) {
      const html = renderToString(
        <ParticipantName name="王o明" award={award} />,
      );
      expect(html).toContain(
        `<strong>王o明</strong><span class="award-badge">${label}</span>`,
      );
      expect(html).not.toContain("官方");
    }
    const unpublished = renderToString(<ParticipantName name="王o明" />);
    expect(unpublished).not.toContain("award-badge");
    expect(unpublished).toContain("王o明");
  });
  it("公告表單分開顯示兩種名額，保留預覽及統一公告", () => {
    const html = renderToString(
      <AwardPanel
        categoryId="program"
        disabled={false}
        onPublished={async () => {}}
      />,
    );
    expect(html).toContain("名次名額");
    expect(html).toContain("佳作名額");
    expect(html).not.toContain("官方確認的獎狀名額");
    expect(html).toContain("預覽公告名單");
    expect(html).toContain("預覽全賽事統一公告");
    expect(html).toContain("每梯次前 3 名");
    expect(html).toContain("50%（小數進位）");
    expect(html).not.toContain("儲存名額");
  });
  it("家長入口可渲染且示範模式清楚標示", () => {
    vi.stubGlobal("location", { hash: "#/" });
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("localStorage", { getItem: () => null });
    const html = renderToString(<App />);
    expect(html).toContain("示範模式");
    expect(html).not.toContain("工作人員入口");
    expect(html).not.toMatch(/href="[^"]*\/staff"/);
    expect(html).toContain("科創機器人組");
    expect(html).toContain("姓名與成績皆為虛構");
    expect(html).not.toContain("本組參賽人數");
    expect(html).not.toContain("搜尋姓名或參賽編號");
    expect(html).toContain("全部梯次");
    expect(html).toContain('aria-label="第 1 梯名單"');
    expect(html).toContain('aria-label="第 2 梯名單"');
    expect(html).not.toContain("名次");
    expect(html).toContain("名單依參賽編號排列");
    expect(html).toContain(
      "「臺中市政府數位發展局獎狀」（每梯次前三名及分數排序前50%為佳作）",
    );
    expect(html).toContain("機A001");
    expect(html).not.toContain("我的關注");
    expect(html).not.toContain("取消關注");
    expect(html).not.toContain("has-award-column");
    expect(html).toContain('aria-label="參賽者成績"');
    expect(html).not.toContain("可左右滑動");
    expect(html).toContain('class="public-result"><div class="result-status"');
    expect(html).toMatch(
      /<small class="participant-meta"><span class="participant-number">[^<]+<\/span><time class="checkin-time"/,
    );
    expect(html).toContain("報到");
    expect(html).toMatch(/[\u4e00-\u9fff]o[\u4e00-\u9fff]/);
    expect(html).not.toContain("學校");
    expect(html).not.toContain("academic-theme");
    expect(html).not.toMatch(/隊伍|隊名|TEAM CHECK-IN/);
  });
  it("裁判入口使用相同梯次分段", () => {
    vi.stubGlobal("location", { hash: "#/challenge/staff" });
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("localStorage", { getItem: () => null });
    const html = renderToString(<App />);
    expect(html).toContain("挑戰賽工作台");
    expect(html).toContain("本組參賽人數");
    expect(html).toContain('class="staff-tabs"');
    expect(html).not.toContain('class="public-result"');
    expect(html).toContain("裁判計分");
    expect(html).toContain("寶礦力水得足球世界盃");
    expect(html).toContain('aria-label="第 1 梯名單"');
    expect(html).toContain('aria-label="第 2 梯名單"');
    expect(html).toContain("本梯次排名");
    expect(html).toContain("各梯次單獨計算名次");
    expect(html).not.toContain("參賽者報到");
    expect(html).toContain("尚未報到");
    expect(html).toContain("已報到");
    expect(html).toContain("飲料已領取");
    expect(html).toContain('class="participant-number"');
    expect(html).toContain('class="round-progress"');
  });
  it("匯入介面使用單人賽用詞並說明家長端姓名遮罩", () => {
    const html = renderToString(
      <ImportPanel
        teams={[]}
        categoryId="preschool"
        onCategoryChange={() => {}}
        onImport={async () => {}}
        disabled={false}
      />,
    );
    expect(html).toContain("賽前參賽者名單");
    expect(html).toContain("每列一位參賽者");
    expect(html).toContain("請先用上方按鈕選擇比賽項目");
    expect(html).not.toContain("目前匯入組別");
    expect(html).toContain("寶礦力水得足球世界盃");
    expect(html).toContain("下載範本");
    expect(html).toContain("不必填組別或梯次");
    expect(html).toContain("幼／動／程／機");
    expect(html).toContain("完整姓名僅工作人員可見");
    expect(html).toContain("姓名第二字顯示為 o");
    expect(html).not.toMatch(/隊伍|隊名/);
  });
  it("項目按鈕使用正式比賽名稱", () => {
    const html = renderToString(
      <CategoryTabs value="creative" onChange={() => {}} />,
    );
    expect(html).toContain("寶礦力水得足球世界盃");
    expect(html).toContain("寶礦力水得大搬運");
    expect(html).toContain("寶礦力水得智慧物流折返跑");
    expect(html).toContain("決戰寶礦力");
    expect(html).toContain("科創機器人組");
  });
  for (const c of categories)
    it(c.name + " 表單可渲染", () => {
      const team: Team = {
        id: "test",
        number: "001",
        name: "陳宥安",
        heat: 1,
        categoryId: c.id,
        checkinStatus: "checked_in",
        checkedInAt: "2026-10-04T01:00:00Z",
      };
      const html = renderToString(
        <ScoreForm
          team={team}
          attempts={[]}
          onSave={async () => {}}
          disabled={false}
        />,
      );
      expect(html).toContain("陳宥安");
      expect(html).toContain("確認並發布成績");
      expect(html).not.toContain("NaN");
      expect(html).not.toContain("提前終止");
      if (c.id === "preschool") expect(html).not.toContain("回合狀態");
    });
  it("未完成表單保留數字欄位且只提供本組原因，秒數沒有時限上限", () => {
    const html = renderToString(
      <ScoreForm
        team={{
          id: "x",
          number: "動A001",
          name: "王小明",
          categoryId: "power",
          heat: 1,
          checkinStatus: "checked_in",
          checkedInAt: null,
        }}
        attempts={[
          {
            id: "a",
            teamId: "x",
            categoryId: "power",
            slotKey: "pull-1",
            attemptNo: 1,
            status: "invalid",
            data: { bottles: 8, seconds: 51.5, failureReason: "超過邊界" },
            submittedAt: "",
            revision: 1,
          },
        ]}
        onSave={async () => {}}
        disabled={false}
      />,
    );
    expect(html).toContain("未完成原因");
    expect(html).toContain("車體鬆脫");
    expect(html).not.toContain("翻覆");
    expect(html).toContain("實際秒數（可留空）");
    expect(html).toContain('value="51.5"');
    expect(html).not.toContain('max="30"');
    expect(html).toContain("修改原因（必填）");
  });
});
it("學科家長入口不渲染內部登分功能", () => {
  vi.stubGlobal("navigator", { onLine: true });
  const html = renderToString(<AcademicApp staffView={false} />);
  expect(html).toContain("檢定學科成績");
  expect(html).toContain("一級檢定");
  expect(html).toContain("二級檢定");
  expect(html).toContain('class="academic-theme academic-shell"');
  expect(html).not.toContain("公布全部學科成績");
  expect(html).not.toContain("目前分數（內部）");
  expect(html).not.toContain("工作人員入口");
  expect(html).not.toMatch(/href="[^"]*\/staff"/);
});
it("工作台只要求 PIN 碼，不顯示帳號或 Email 欄位", () => {
  const html = renderToString(<Login />);
  expect(html).toContain('type="password"');
  expect(html).toContain("工作人員 PIN 碼");
  expect(html).toContain("4 位數 PIN 碼");
  expect(html).not.toContain('type="email"');
  expect(html).not.toContain("staff@ttra-score.invalid");
  expect(html).not.toContain("登入連結");
});
it("學科裁判入口與家長入口使用相同的獨立配色", () => {
  vi.stubGlobal("navigator", { onLine: true });
  const html = renderToString(<AcademicApp staffView={true} />);
  expect(html).toContain('class="academic-theme academic-shell"');
  expect(html).toContain("學科成績工作台");
  expect(html).toContain("最近 10 筆");
  expect(html).not.toContain("最近 200 筆");
  expect(html).not.toContain("公布全部等級已登錄的成績");
  expect(html).not.toContain("可等批改完成後再操作");
  expect(html).not.toContain("新登分及更正都需要再次公布");
  expect(html).toContain("公布全部學科成績");
  expect(html.indexOf('class="panel publication-panel"')).toBeLessThan(
    html.indexOf('aria-label="檢定等級"'),
  );
  expect(html.indexOf('aria-label="檢定等級"')).toBeLessThan(
    html.indexOf("學科登分名單"),
  );
  expect(html).toContain("機581115100401");
  expect(html).not.toContain("E101");
});
it("學科裁判名單的登分操作位於參賽編號左側", () => {
  // SSR starts in the loading state; check the async list's JSX order directly.
  const source = readFileSync(
    new URL("../src/AcademicApp.tsx", import.meta.url),
    "utf8",
  );
  const table = source.match(/<Table>[\s\S]*?<\/Table>/)?.[0] ?? "";
  const headers = [...table.matchAll(/<TableHead>([\s\S]*?)<\/TableHead>/g)];
  expect(headers.map((header) => header[1])).toEqual([
    "操作",
    "參賽編號",
    "姓名",
    "目前分數（內部）",
    "公開分數",
  ]);
  const cells = [...table.matchAll(/<TableCell>([\s\S]*?)<\/TableCell>/g)];
  expect(cells[0][1]).toContain("<Button");
  expect(cells[0][1]).toContain('{c.score === null ? "登分" : "修改"}');
  expect(cells[0][1]).toContain("disabled={busy || !online}");
  expect(cells[0][1]).toContain("setSelected(c)");
  expect(cells[1][1]).toBe("{c.number}");
});
it("檢定等級切換按鈕標示選取狀態且可保留未辨識舊名單", () => {
  const html = renderToString(
    <AcademicLevelTabs value={2} onChange={() => {}} includeUnassigned />,
  );
  expect(html).toContain('aria-label="檢定等級"');
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain("一級檢定");
  expect(html).toContain("二級檢定");
  expect(html).toContain("待確認等級");
});
