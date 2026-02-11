export type FinancePeriodId =
  | "today"
  | "yesterday"
  | "7days"
  | "30days"
  | "week"
  | "month";

export type FinanceKpiId = "revenue" | "margin" | "sales" | "avgCheck";
export type FinanceDetailTone = "normal" | "muted" | "accent";

export type FinanceDetailRow = {
  name: string;
  hint: string;
  value: string;
  tone: FinanceDetailTone;
};

export type FinanceKpi = {
  label: string;
  value: string;
  delta: string;
  footnote: string;
};

export type FinancePeriod = {
  id: FinancePeriodId;
  label: string;
  range: {
    start: string;
    end: string;
  };
  summary: {
    badge: string;
    value: string;
    deltaValue: string;
    caption: string;
  };
  kpis: Record<FinanceKpiId, FinanceKpi>;
  details: FinanceDetailRow[];
};

export type FinancePeriodOption = {
  id: FinancePeriodId;
  label: string;
};

export const DEFAULT_FINANCE_PERIOD_ID: FinancePeriodId = "30days";

export const FINANCE_PERIOD_OPTIONS: FinancePeriodOption[] = [
  { id: "today", label: "Сегодня" },
  { id: "yesterday", label: "Вчера" },
  { id: "7days", label: "7 дней" },
  { id: "30days", label: "30 дней" },
  { id: "week", label: "Неделя" },
  { id: "month", label: "Месяц" },
];

export const FINANCE_PERIODS: Record<FinancePeriodId, FinancePeriod> = {
  today: {
    id: "today",
    label: "Сегодня",
    range: {
      start: "1 фев 2026",
      end: "1 фев 2026",
    },
    summary: {
      badge: "+3%",
      value: "6 320,00 ₽",
      deltaValue: "▲ +180 ₽",
      caption: "за сегодня",
    },
    kpis: {
      revenue: {
        label: "Выручка",
        value: "6,3к ₽",
        delta: "+3%",
        footnote: "период",
      },
      margin: {
        label: "Маржа",
        value: "100%",
        delta: "0%",
        footnote: "сеть",
      },
      sales: {
        label: "Продажи",
        value: "42",
        delta: "+2%",
        footnote: "период",
      },
      avgCheck: {
        label: "Ср. чек",
        value: "150 ₽",
        delta: "+1%",
        footnote: "период",
      },
    },
    details: [
      { name: "Эквайринг", hint: "0.0%", value: "0,00 ₽", tone: "normal" },
      {
        name: "После комиссии",
        hint: "выплаты",
        value: "6 320,00 ₽",
        tone: "muted",
      },
      { name: "Налоги", hint: "УСН 6%", value: "0,00 ₽", tone: "normal" },
      {
        name: "Расходы",
        hint: "аренда, прочее",
        value: "0,00 ₽",
        tone: "normal",
      },
      { name: "Итого", hint: "прибыль", value: "6 320,00 ₽", tone: "accent" },
    ],
  },
  yesterday: {
    id: "yesterday",
    label: "Вчера",
    range: {
      start: "31 янв 2026",
      end: "31 янв 2026",
    },
    summary: {
      badge: "+5%",
      value: "5 980,00 ₽",
      deltaValue: "▲ +280 ₽",
      caption: "за вчера",
    },
    kpis: {
      revenue: {
        label: "Выручка",
        value: "6,0к ₽",
        delta: "+5%",
        footnote: "период",
      },
      margin: {
        label: "Маржа",
        value: "100%",
        delta: "0%",
        footnote: "сеть",
      },
      sales: {
        label: "Продажи",
        value: "40",
        delta: "+4%",
        footnote: "период",
      },
      avgCheck: {
        label: "Ср. чек",
        value: "149 ₽",
        delta: "+2%",
        footnote: "период",
      },
    },
    details: [
      { name: "Эквайринг", hint: "0.0%", value: "0,00 ₽", tone: "normal" },
      {
        name: "После комиссии",
        hint: "выплаты",
        value: "5 980,00 ₽",
        tone: "muted",
      },
      { name: "Налоги", hint: "УСН 6%", value: "0,00 ₽", tone: "normal" },
      {
        name: "Расходы",
        hint: "аренда, прочее",
        value: "0,00 ₽",
        tone: "normal",
      },
      { name: "Итого", hint: "прибыль", value: "5 980,00 ₽", tone: "accent" },
    ],
  },
  "7days": {
    id: "7days",
    label: "7 дней",
    range: {
      start: "26 янв 2026",
      end: "1 фев 2026",
    },
    summary: {
      badge: "+6%",
      value: "38 900,00 ₽",
      deltaValue: "▲ +2 200 ₽",
      caption: "за 7 дней",
    },
    kpis: {
      revenue: {
        label: "Выручка",
        value: "39к ₽",
        delta: "+6%",
        footnote: "период",
      },
      margin: {
        label: "Маржа",
        value: "100%",
        delta: "0%",
        footnote: "сеть",
      },
      sales: {
        label: "Продажи",
        value: "252",
        delta: "+4%",
        footnote: "период",
      },
      avgCheck: {
        label: "Ср. чек",
        value: "154 ₽",
        delta: "+2%",
        footnote: "период",
      },
    },
    details: [
      { name: "Эквайринг", hint: "0.0%", value: "0,00 ₽", tone: "normal" },
      {
        name: "После комиссии",
        hint: "выплаты",
        value: "38 900,00 ₽",
        tone: "muted",
      },
      { name: "Налоги", hint: "УСН 6%", value: "0,00 ₽", tone: "normal" },
      {
        name: "Расходы",
        hint: "аренда, прочее",
        value: "0,00 ₽",
        tone: "normal",
      },
      {
        name: "Итого",
        hint: "прибыль",
        value: "38 900,00 ₽",
        tone: "accent",
      },
    ],
  },
  "30days": {
    id: "30days",
    label: "За 30 дней",
    range: {
      start: "31 дек 2025",
      end: "29 янв 2026",
    },
    summary: {
      badge: "+8%",
      value: "151 280,00 ₽",
      deltaValue: "▲ +11 190 ₽",
      caption: "за 30 дней",
    },
    kpis: {
      revenue: {
        label: "Выручка",
        value: "151к ₽",
        delta: "+8%",
        footnote: "период",
      },
      margin: {
        label: "Маржа",
        value: "100%",
        delta: "0%",
        footnote: "сеть",
      },
      sales: {
        label: "Продажи",
        value: "971",
        delta: "+5%",
        footnote: "период",
      },
      avgCheck: {
        label: "Ср. чек",
        value: "155 ₽",
        delta: "+3%",
        footnote: "период",
      },
    },
    details: [
      { name: "Эквайринг", hint: "0.0%", value: "0,00 ₽", tone: "normal" },
      {
        name: "После комиссии",
        hint: "выплаты",
        value: "151 280,00 ₽",
        tone: "muted",
      },
      { name: "Налоги", hint: "УСН 6%", value: "0,00 ₽", tone: "normal" },
      {
        name: "Расходы",
        hint: "аренда, прочее",
        value: "0,00 ₽",
        tone: "normal",
      },
      {
        name: "Итого",
        hint: "прибыль",
        value: "151 280,00 ₽",
        tone: "accent",
      },
    ],
  },
  week: {
    id: "week",
    label: "Неделя",
    range: {
      start: "27 янв 2026",
      end: "2 фев 2026",
    },
    summary: {
      badge: "+4%",
      value: "41 850,00 ₽",
      deltaValue: "▲ +1 100 ₽",
      caption: "за неделю",
    },
    kpis: {
      revenue: {
        label: "Выручка",
        value: "41,9к ₽",
        delta: "+4%",
        footnote: "период",
      },
      margin: {
        label: "Маржа",
        value: "100%",
        delta: "0%",
        footnote: "сеть",
      },
      sales: {
        label: "Продажи",
        value: "265",
        delta: "+3%",
        footnote: "период",
      },
      avgCheck: {
        label: "Ср. чек",
        value: "158 ₽",
        delta: "+2%",
        footnote: "период",
      },
    },
    details: [
      { name: "Эквайринг", hint: "0.0%", value: "0,00 ₽", tone: "normal" },
      {
        name: "После комиссии",
        hint: "выплаты",
        value: "41 850,00 ₽",
        tone: "muted",
      },
      { name: "Налоги", hint: "УСН 6%", value: "0,00 ₽", tone: "normal" },
      {
        name: "Расходы",
        hint: "аренда, прочее",
        value: "0,00 ₽",
        tone: "normal",
      },
      {
        name: "Итого",
        hint: "прибыль",
        value: "41 850,00 ₽",
        tone: "accent",
      },
    ],
  },
  month: {
    id: "month",
    label: "Месяц",
    range: {
      start: "1 янв 2026",
      end: "31 янв 2026",
    },
    summary: {
      badge: "+7%",
      value: "158 200,00 ₽",
      deltaValue: "▲ +9 500 ₽",
      caption: "за месяц",
    },
    kpis: {
      revenue: {
        label: "Выручка",
        value: "158к ₽",
        delta: "+7%",
        footnote: "период",
      },
      margin: {
        label: "Маржа",
        value: "100%",
        delta: "0%",
        footnote: "сеть",
      },
      sales: {
        label: "Продажи",
        value: "1 010",
        delta: "+4%",
        footnote: "период",
      },
      avgCheck: {
        label: "Ср. чек",
        value: "157 ₽",
        delta: "+2%",
        footnote: "период",
      },
    },
    details: [
      { name: "Эквайринг", hint: "0.0%", value: "0,00 ₽", tone: "normal" },
      {
        name: "После комиссии",
        hint: "выплаты",
        value: "158 200,00 ₽",
        tone: "muted",
      },
      { name: "Налоги", hint: "УСН 6%", value: "0,00 ₽", tone: "normal" },
      {
        name: "Расходы",
        hint: "аренда, прочее",
        value: "0,00 ₽",
        tone: "normal",
      },
      {
        name: "Итого",
        hint: "прибыль",
        value: "158 200,00 ₽",
        tone: "accent",
      },
    ],
  },
};

export const getFinancePeriod = (id: FinancePeriodId): FinancePeriod =>
  FINANCE_PERIODS[id] ?? FINANCE_PERIODS[DEFAULT_FINANCE_PERIOD_ID];
