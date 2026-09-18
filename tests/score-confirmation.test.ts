import { describe, it, expect } from "vitest";
import {
  bothConfirmed,
  confirmScore,
  emptyConfirmation,
} from "../src/score-confirmation";

describe("雙方成績確認", () => {
  it.each(["preschool", "power", "program", "creative"])(
    "%s 必須兩個不同角色確認同份成績",
    (category) => {
      const signature = JSON.stringify({
        category,
        slot: "first",
        revision: 0,
        seconds: 25,
      });
      const initial = emptyConfirmation(signature);
      expect(bothConfirmed(initial, signature)).toBe(false);
      const judge = confirmScore(initial, signature, "judge");
      expect(bothConfirmed(judge, signature)).toBe(false);
      expect(
        bothConfirmed(confirmScore(judge, signature, "judge"), signature),
      ).toBe(false);
      expect(
        bothConfirmed(confirmScore(judge, signature, "participant"), signature),
      ).toBe(true);
      const participant = confirmScore(initial, signature, "participant");
      expect(bothConfirmed(participant, signature)).toBe(false);
      expect(
        bothConfirmed(confirmScore(participant, signature, "judge"), signature),
      ).toBe(true);
    },
  );
  it.each(["分數", "回合", "選手", "未完成原因", "更正原因", "版本"])(
    "%s 變更後不可沿用舊確認",
    (field) => {
      const old = { signature: "old", judge: true, participant: true };
      expect(bothConfirmed(old, field)).toBe(false);
      const updated = confirmScore(old, field, "participant");
      expect(updated).toEqual({
        signature: field,
        judge: false,
        participant: true,
      });
      expect(bothConfirmed(updated, field)).toBe(false);
    },
  );
  it("返回檢查或重新開啟時清除兩項確認", () => {
    expect(emptyConfirmation("same-score")).toEqual({
      signature: "same-score",
      judge: false,
      participant: false,
    });
  });
});
