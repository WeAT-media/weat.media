//! Ранжирование ленты. Алгоритм открыт намеренно: любой может форкнуть его и собрать свой дайджест.
//!
//! - new  — новые сверху (keyset-курсор по времени);
//! - hot  — «горячее»: очки делятся на возраст, (лайки + 2·комментарии + 1) / (часы + 2)^1.5;
//!   лайки — взвешенные (like_score): самолайк 0, свежий аккаунт 0.25–0.5, см. 0006_like_weight.sql;
//!   у видео к очкам добавляются досмотры до конца (completes, COMPLETE_WEIGHT за каждый).
//!   Свежая запись при равных очках выше, старая уходит вниз; комментарий весит вдвое — это усилие;
//! - best — «лучшее» за период: по взвешенным лайкам или по комментариям.
//!
//! Возраст — от публикации оригинала (published_at): импорт старой новости не делает её свежей.
//! hot и best листаются по смещению: порядок пересчитывается на каждый запрос.

/// старше этого hot не рассматривает: за двое суток формула прижимает любую запись к нулю,
/// а окно ограничивает сортировку небольшой частью индекса
pub const HOT_WINDOW_DAYS: i32 = 14;
pub const COMMENT_WEIGHT: f64 = 2.0;
pub const GRAVITY: f64 = 1.5;
/// досмотр видео до конца (≥ 90%) весит как лайк: смотреть до конца — сильнее, чем открыть
pub const COMPLETE_WEIGHT: f64 = 1.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Metric {
    #[default]
    Likes,
    Comments,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Period {
    Day,
    Week,
    Month,
    All,
}

impl Period {
    pub fn days(self) -> Option<i32> {
        match self {
            Period::Day => Some(1),
            Period::Week => Some(7),
            Period::Month => Some(30),
            Period::All => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Sort {
    #[default]
    New,
    Hot,
    Best {
        metric: Metric,
        period: Period,
    },
}

impl Sort {
    pub fn parse(
        sort: Option<&str>,
        metric: Option<&str>,
        period: Option<&str>,
    ) -> Result<Self, &'static str> {
        match sort.unwrap_or("new") {
            "new" | "" => Ok(Sort::New),
            "hot" => Ok(Sort::Hot),
            "best" => {
                let metric = match metric.unwrap_or("likes") {
                    "likes" => Metric::Likes,
                    "comments" => Metric::Comments,
                    _ => return Err("metric: likes | comments"),
                };
                let period = match period.unwrap_or("week") {
                    "day" => Period::Day,
                    "week" => Period::Week,
                    "month" => Period::Month,
                    "all" => Period::All,
                    _ => return Err("period: day | week | month | all"),
                };
                Ok(Sort::Best { metric, period })
            }
            _ => Err("sort: new | hot | best"),
        }
    }

    /// (score, доп. условие WHERE, ORDER BY) — только константы из этого модуля, без ввода пользователя
    pub fn sql(self) -> (String, String, String) {
        // float8: extract(epoch …) отдаёт numeric, а numeric-арифметика по окну заметно медленнее
        let hot = format!(
            "(a.like_score + {COMMENT_WEIGHT} * a.comment_count + {COMPLETE_WEIGHT} * a.completes + 1)::float8
             / power(greatest(extract(epoch FROM now() - a.published_at)::float8, 0) / 3600 + 2, {GRAVITY})"
        );
        match self {
            Sort::New => (
                "NULL::float8".into(),
                String::new(),
                "a.created_at DESC, a.uri DESC".into(),
            ),
            Sort::Hot => (
                hot.clone(),
                format!("AND a.published_at > now() - interval '{HOT_WINDOW_DAYS} days'"),
                format!("{hot} DESC, a.published_at DESC, a.uri DESC"),
            ),
            Sort::Best { metric, period } => {
                let col = match metric {
                    Metric::Likes => "a.like_score",
                    Metric::Comments => "a.comment_count",
                };
                let since = period
                    .days()
                    .map(|d| format!("AND a.published_at > now() - interval '{d} days'"))
                    .unwrap_or_default();
                (
                    format!("{col}::float8"),
                    since,
                    format!("{col} DESC, a.created_at DESC, a.uri DESC"),
                )
            }
        }
    }
}

/// «Читать дальше» к статье: общие теги (TAG_WEIGHT за тег) и читатели, лайкнувшие обе
/// (CO_LIKE_WEIGHT за читателя, только лайки с весом > 0), делённые на √(дни + 1) — свежее при равных выше.
pub const TAG_WEIGHT: f64 = 3.0;
pub const CO_LIKE_WEIGHT: f64 = 2.0;

/// кандидаты ограничены: у популярной статьи тысячи лайков, полный «кто лайкнул обе» — это самосоединение
/// таблицы лайков. Берём последних читателей и их последние лайки — для «похожего» этого хватает.
pub const RELATED_TAG_CANDIDATES: i64 = 2_000;
pub const RELATED_LIKERS: i64 = 500;
pub const RELATED_LIKES_PER_READER: i64 = 50;

pub fn related_sql() -> String {
    format!(
        "WITH src AS (SELECT uri, tags FROM articles WHERE uri = $1),
         readers AS (
           SELECT did FROM likes WHERE subject_uri = $1 AND weight > 0
           ORDER BY created_at DESC LIMIT {RELATED_LIKERS}
         ),
         co AS (
           SELECT l.subject_uri AS uri, count(*) AS n
           FROM readers r CROSS JOIN LATERAL (
             SELECT subject_uri FROM likes
             WHERE did = r.did AND subject_uri <> $1 AND weight > 0
             ORDER BY created_at DESC LIMIT {RELATED_LIKES_PER_READER}
           ) l
           GROUP BY l.subject_uri
         ),
         by_tags AS (
           SELECT a.uri, a.tags, a.published_at FROM articles a, src
           WHERE a.tags && src.tags AND a.uri <> src.uri AND ($3::text IS NULL OR a.kind = $3)
           ORDER BY a.published_at DESC LIMIT {RELATED_TAG_CANDIDATES}
         ),
         -- общие читатели приходят вместе с кандидатом: отдельный join с co планировщик делал вложенным циклом
         cand AS (
           SELECT uri, max(n) AS n FROM (
             SELECT uri, 0 AS n FROM by_tags UNION ALL SELECT uri, n FROM co
           ) x GROUP BY uri
         ),
         top AS (
           SELECT a.uri,
             ({TAG_WEIGHT} * cardinality(ARRAY(SELECT unnest(a.tags) INTERSECT SELECT unnest(src.tags)))
              + {CO_LIKE_WEIGHT} * cand.n)::float8
             / sqrt(greatest(extract(epoch FROM now() - a.published_at)::float8, 0) / 86400 + 1) AS score
           FROM cand JOIN articles a ON a.uri = cand.uri CROSS JOIN src
           WHERE $3::text IS NULL OR a.kind = $3
           ORDER BY score DESC, a.published_at DESC
           LIMIT $2
         )
         SELECT a.uri, a.cid, a.did, h.handle, a.created_at, a.indexed_at, a.record - 'text' AS record,
                coalesce(char_length(a.record->>'text'), 0) AS text_length, a.like_count, a.comment_count,
                top.score
         FROM top JOIN articles a ON a.uri = top.uri LEFT JOIN handles h ON h.did = a.did
         WHERE top.score > 0
         ORDER BY top.score DESC, a.published_at DESC"
    )
}

/// та же формула, что в SQL, — для тестов и для тех, кто считает у себя
#[cfg_attr(not(test), allow(dead_code))]
pub fn hot_score(likes: f64, comments: i32, completes: i32, age_hours: f64) -> f64 {
    (likes + COMMENT_WEIGHT * comments as f64 + COMPLETE_WEIGHT * completes as f64 + 1.0)
        / (age_hours.max(0.0) + 2.0).powf(GRAVITY)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hot_prefers_fresh_and_discussed() {
        // свежая без реакций ниже, чем свежая с обсуждением
        assert!(hot_score(0.0, 3, 0, 1.0) > hot_score(0.0, 0, 0, 1.0));
        // комментарий весит как два лайка, досмотр — как лайк
        assert_eq!(hot_score(2.0, 0, 0, 5.0), hot_score(0.0, 1, 0, 5.0));
        assert_eq!(hot_score(1.0, 0, 0, 5.0), hot_score(0.0, 0, 1, 5.0));
        // через сутки сильная запись уступает свежей средней
        assert!(hot_score(5.0, 1, 0, 1.0) > hot_score(20.0, 2, 0, 24.0));
        // дата из будущего не даёт бонуса
        assert_eq!(hot_score(1.0, 0, 0, -10.0), hot_score(1.0, 0, 0, 0.0));
    }

    #[test]
    fn parses_sort() {
        assert_eq!(Sort::parse(None, None, None), Ok(Sort::New));
        assert_eq!(Sort::parse(Some("hot"), None, None), Ok(Sort::Hot));
        assert_eq!(
            Sort::parse(Some("best"), Some("comments"), Some("day")),
            Ok(Sort::Best {
                metric: Metric::Comments,
                period: Period::Day
            })
        );
        assert_eq!(
            Sort::parse(Some("best"), None, None),
            Ok(Sort::Best {
                metric: Metric::Likes,
                period: Period::Week
            })
        );
        assert!(Sort::parse(Some("top"), None, None).is_err());
        assert!(Sort::parse(Some("best"), Some("views"), None).is_err());
        assert!(Sort::parse(Some("best"), None, Some("year")).is_err());
    }
}
