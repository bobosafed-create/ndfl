export const CONSULTATION_TARIFFS = Object.freeze([
  Object.freeze({ code: "situation-check", name: "Проверка ситуации", description: "Персональная проверка НДФЛ, обязанности подать 3-НДФЛ и возможных способов уменьшить налог или получить возврат", amountKopecks: 39000, deadlineMinutes: 240, recommended: true }),
  Object.freeze({ code: "detailed-review", name: "Расчёт и подробный разбор", description: "Расчёт налога или возврата, нормативные основания и подробные рекомендации по следующим действиям", amountKopecks: 99000, deadlineMinutes: 480 }),
]);

export const URGENT_ADDON = Object.freeze({
  code: "urgent",
  name: "Срочно",
  description: "Приоритетная подготовка письменного результата в течение 2 часов",
  amountKopecks: 30000,
  deadlineMinutes: 120,
});

export function resolveTariff(code, _defaultAmountKopecks, urgent = false) {
  const selected = CONSULTATION_TARIFFS.find((tariff) => tariff.code === code) ?? CONSULTATION_TARIFFS[0];
  if (!urgent) return selected;
  return {
    ...selected,
    code: `${selected.code}-urgent`,
    name: `${selected.name} · Срочно`,
    description: `${selected.description}. ${URGENT_ADDON.description}.`,
    amountKopecks: selected.amountKopecks + URGENT_ADDON.amountKopecks,
    deadlineMinutes: URGENT_ADDON.deadlineMinutes,
  };
}
