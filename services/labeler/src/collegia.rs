//! Коллегии присяжных и их метки. id — поддомен (<id>.justice.weat.media); значения меток — как на сайте
//! (src/data/mock.ts → настройки «Модерация»), менять их нельзя: на них ссылаются настройки читателей.

pub struct Value {
    pub value: &'static str,
    pub description: &'static str,
    /// hide | warn | ignore — по умолчанию у читателя
    pub default_action: &'static str,
}

pub struct Collegium {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub labels: &'static [Value],
}

const fn v(value: &'static str, description: &'static str, default_action: &'static str) -> Value {
    Value { value, description, default_action }
}

pub const ALL: &[Collegium] = &[
    Collegium {
        id: "spam",
        name: "Коллегия по накруткам и спаму",
        description: "Искусственный рейтинг: купленные голоса, боты, накрутка просмотров и подписчиков.",
        labels: &[v("verdict.upvote-fraud", "Накрутка рейтинга и голосов", "hide"), v("verdict.view-fraud", "Накрутка просмотров, боты, купленные подписчики", "warn")],
    },
    Collegium {
        id: "tech",
        name: "Техническая экспертиза",
        description: "Инженеры проверяют код-примеры и выводы статей: компилируют, запускают, замеряют.",
        labels: &[
            v("verdict.insufficient-expertise", "Недостаточная техническая экспертиза: ошибки, поверхностные выводы", "warn"),
            v("verdict.broken-code", "Код из статьи не работает или искажён", "warn"),
            v("verdict.fake-benchmarks", "Сфабрикованные бенчмарки", "hide"),
        ],
    },
    Collegium {
        id: "law",
        name: "Коллегия по законности",
        description: "Возможные нарушения закона: запрещённый контент, авторские права, персональные данные. Не заменяет решение суда.",
        labels: &[
            v("verdict.illegal", "Нарушение закона", "hide"),
            v("verdict.copyright", "Нарушение авторских прав", "hide"),
            v("verdict.personal-data", "Раскрытие персональных данных без согласия", "hide"),
        ],
    },
    Collegium {
        id: "tone",
        name: "Коллегия тона и манеры",
        description: "Токсичность, переходы на личности, рекламный тон. Подписка — по желанию.",
        labels: &[v("verdict.promo", "Скрытая реклама без маркировки", "warn"), v("verdict.toxic", "Токсичность, переход на личности", "ignore")],
    },
    Collegium {
        id: "general",
        name: "Общая коллегия",
        description: "Всё, что не подходит профильным коллегиям: недостоверность, плагиат, иные нарушения правил.",
        labels: &[
            v("verdict.misleading", "Содержит существенно недостоверные утверждения", "warn"),
            v("verdict.plagiarism", "Плагиат без указания источника", "hide"),
            v("verdict.other", "Иное нарушение правил площадки", "warn"),
        ],
    },
];
