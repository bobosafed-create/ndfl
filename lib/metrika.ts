export const YANDEX_METRIKA_ID = 111896007;

type MetrikaGoal = "payment_started" | "purchase";
type MetrikaParams = Record<string, string | number | boolean | null | undefined>;

declare global {
  interface Window {
    ym?: (counterId: number, method: "reachGoal", goal: MetrikaGoal, params?: MetrikaParams) => void;
  }
}

export function reachMetrikaGoal(goal: MetrikaGoal, params?: MetrikaParams) {
  if (typeof window === "undefined") return;
  window.ym?.(YANDEX_METRIKA_ID, "reachGoal", goal, params);
}

