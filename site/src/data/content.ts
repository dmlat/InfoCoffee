export const content = {
  header: {
    logo: "InfoCoffe",
    tag: "финансы без лишнего",
    nav: [
      { label: "Главная", href: "#hero" },
      { label: "Финансы", href: "#finance" },
      { label: "Аналитика", href: "#analytics" },
      { label: "Склад", href: "#stock" },
      { label: "Вопросы", href: "#faq" },
    ],
    actions: {
      login: "Войти",
      start: "Начать",
      mockup: "Настройка мокапа",
    },
  },
  hero: {
    badge: "Новый подход к финансам",
    title: "Управляйте бюджетом, цельно и спокойно, в одном приложении",
    description:
      "Собирает доходы, расходы и цели в понятную картину. Простые отчеты, умные подсказки и быстрые сценарии — чтобы решения было проще принимать", // "InfoCoffee" убрано, первая буква заглавная
    actions: {
      primary: "Попробовать бесплатно",
      secondary: "Смотреть демо",
    },
    stats: [
      { value: "98%", label: "пользователей отмечают рост контроля" },
      { value: "2 мин", label: "до первой аналитики" },
    ],
    preview: {
      title: "Финансовый пульс",
      chip: "+12%",
      total: "₽ 164 000",
      caption: "свободный баланс",
    },
    note: "AI-советы подскажут, где оптимизировать расходы уже в эту неделю",
  },
  appPreview: {
    kicker: "", 
    title: "Управление кофейнями в Telegram",
    subhead: "Финансы, склад и управление персоналом в одном окне",
    cards: [
      {
        title: "Аналитика в кармане",
        pill: "TG Mini App",
        description: "Мгновенный доступ к выручке и чистой прибыли. Нативно, быстро, всегда под рукой",
        phone: {
          alt: "Дашборд",
          fallback: "Скриншот",
          fallbackNote: "screenshot-dashboard.jpg",
        },
      },
      {
        title: "Честный P&L",
        pill: "Авто-вычеты",
        description: "Автоматический расчет чистой прибыли с учетом эквайринга, налогов и себестоимости",
        wfNav: [
          { label: "Выручка", type: "is-active", icon: "revenue" },
          { label: "Себестоимость", type: "is-red", icon: "cost" },
          { label: "Налог", type: "is-red", icon: "tax" },
          { label: "Эквайринг", type: "is-red", icon: "acquiring" },
          { label: "Прибыль", type: "is-profit", icon: "profit" },
        ],
        result: {
          label: "Маржа: 34%",
          badge: "В реальном времени",
        },
      },
      {
        title: "Роли и задачи",
        pill: "Доступы",
        description: "Контроль сотрудников через бота. Гибкие доступы защищают от хаоса и ошибок",
        roles: [
          {
            icon: "admin",
            title: "Админ",
            desc: "Полный доступ ко всем данным",
            pill: "Admin",
          },
          {
            icon: "staff",
            title: "Сервис",
            desc: "Работа с задачами без доступа к выручке",
            pill: "Staff",
          },
        ],
      },
      {
        title: "Экосистема управления",
        pill: "Интеграции",
        description: "Единый центр контроля оборудования и складских запасов",
        hub: [
          {
            icon: "wms",
            title: "Умный склад",
            text: "Списание по техкартам, авто-контроль",
          },
          {
            icon: "integrations",
            title: "Интеграции",
            text: "Связь с Vendista, 1C и вашими БД через API",
          },
          {
            icon: "ai",
            title: "AI Ассистент",
            beta: true,
            text: "Анализ показателей, голосовое управление",
          },
          {
            icon: "stock",
            title: "Стоп-дефицит",
            text: "Уведомления о нехватке товара и задачи",
          },
        ],
      },
    ],
  },
}