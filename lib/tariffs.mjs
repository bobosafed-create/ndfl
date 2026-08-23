export const CONSULTATION_TARIFFS = Object.freeze([
  Object.freeze({ code: "basic", name: "Базовый", description: "Один простой вопрос без расчётов, краткий письменный ответ", amountKopecks: 20000, deadlineMinutes: 240 }),
  Object.freeze({ code: "standard", name: "Стандартный", description: "Подробный ответ с пояснением и рекомендуемыми действиями", amountKopecks: 40000, deadlineMinutes: 240, recommended: true }),
  Object.freeze({ code: "urgent", name: "Срочный", description: "Стандартный письменный ответ с приоритетной обработкой", amountKopecks: 75000, deadlineMinutes: 60 }),
  Object.freeze({ code: "complex", name: "Сложный случай", description: "Разбор ситуации с налоговыми расчётами и пояснениями", amountKopecks: 99000, deadlineMinutes: 480 }),
]);

export function resolveTariff(code, defaultAmountKopecks) {
  const selected = CONSULTATION_TARIFFS.find((tariff) => tariff.code === code);
  if (selected) return selected;
  return {
    code: "consultant-default",
    name: "Текущая консультация",
    description: "Один письменный вопрос по цене, установленной консультантом",
    amountKopecks: defaultAmountKopecks,
    deadlineMinutes: 240,
  };
}
