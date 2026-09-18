export type ConfirmationRole = "judge" | "participant";
export type ScoreConfirmation = {
  signature: string;
  judge: boolean;
  participant: boolean;
};

export function emptyConfirmation(signature = ""): ScoreConfirmation {
  return { signature, judge: false, participant: false };
}

export function confirmScore(
  current: ScoreConfirmation,
  signature: string,
  role: ConfirmationRole,
): ScoreConfirmation {
  return {
    ...(current.signature === signature
      ? current
      : emptyConfirmation(signature)),
    [role]: true,
  };
}

export function bothConfirmed(current: ScoreConfirmation, signature: string) {
  return (
    current.signature === signature && current.judge && current.participant
  );
}
