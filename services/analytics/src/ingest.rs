//! Приём событий: валидация в обработчике, агрегация в памяти, пакетная запись раз в секунду.
//! На запрос — только отправка в канал; БД не участвует в горячем пути.

use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasher, RandomState};
use std::time::{Duration, Instant};

use chrono::NaiveDate;
use sqlx::PgPool;
use tokio::sync::mpsc;

use crate::classify::Source;

#[derive(Debug, Clone)]
pub enum Kind {
    View { source: Source, utm: Option<Utm>, anon: bool, canvas: Option<String> },
    Read,
    Time { ms: i64 },
    /// видео запущено
    Play,
    /// видео досмотрено до конца (≥ 90% длительности)
    Complete,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Utm {
    pub source: String,
    pub medium: String,
    pub campaign: String,
}

#[derive(Debug, Clone)]
pub struct Event {
    pub article_id: String,
    pub day: NaiveDate,
    pub visitor: [u8; 8],
    pub kind: Kind,
}

#[derive(Default, Debug, Clone, Copy, PartialEq, Eq)]
pub struct Counters {
    pub views: i64,
    pub anon_views: i64,
    pub reads: i64,
    pub time_ms_sum: i64,
    pub time_n: i64,
    pub plays: i64,
    pub completes: i64,
}

type Key = (String, NaiveDate);

/// Пакет событий, свёрнутый в счётчики — одна строка upsert на статью и день
#[derive(Default, Debug)]
pub struct Batch {
    pub daily: HashMap<Key, Counters>,
    pub sources: HashMap<(String, NaiveDate, &'static str, String), i64>,
    pub utm: HashMap<(String, NaiveDate, Utm), i64>,
    pub canvas: HashMap<(String, NaiveDate, String), i64>,
    pub visitors: HashSet<(String, NaiveDate, [u8; 8])>,
    pub len: usize,
}

/// повторный просмотр той же статьи тем же посетителем в течение окна не считается (перезагрузки, накрутка).
/// Ключ — хеш id статьи (а не строка) и жёсткий потолок записей: поток случайных id/UA не раздувает память.
pub struct Dedupe {
    window: Duration,
    cap: usize,
    hasher: RandomState,
    seen: HashMap<(u64, [u8; 8]), Instant>,
}

pub const DEDUPE_CAP: usize = 1_000_000;

impl Dedupe {
    pub fn new(window: Duration) -> Self {
        Self::with_cap(window, DEDUPE_CAP)
    }
    pub fn with_cap(window: Duration, cap: usize) -> Self {
        Self { window, cap, hasher: RandomState::new(), seen: HashMap::new() }
    }
    /// false — повтор в окне или таблица полна (событие отбрасываем)
    pub fn fresh(&mut self, article: &str, visitor: [u8; 8], now: Instant) -> bool {
        let key = (self.hasher.hash_one(article), visitor);
        match self.seen.get(&key) {
            Some(t) if now.duration_since(*t) < self.window => false,
            Some(_) => {
                self.seen.insert(key, now);
                true
            }
            None => {
                if self.seen.len() >= self.cap {
                    self.prune(now);
                    if self.seen.len() >= self.cap {
                        return false;
                    }
                }
                self.seen.insert(key, now);
                true
            }
        }
    }
    pub fn prune(&mut self, now: Instant) {
        let w = self.window;
        self.seen.retain(|_, t| now.duration_since(*t) < w);
    }
}

impl Batch {
    pub fn add(&mut self, e: Event) {
        self.len += 1;
        let c = self.daily.entry((e.article_id.clone(), e.day)).or_default();
        match e.kind {
            Kind::View { source, utm, anon, canvas } => {
                c.views += 1;
                if anon {
                    c.anon_views += 1;
                }
                *self.sources.entry((e.article_id.clone(), e.day, source.channel, source.name)).or_default() += 1;
                if let Some(u) = utm {
                    *self.utm.entry((e.article_id.clone(), e.day, u)).or_default() += 1;
                }
                if let Some(hash) = canvas {
                    *self.canvas.entry((e.article_id.clone(), e.day, hash)).or_default() += 1;
                }
                self.visitors.insert((e.article_id, e.day, e.visitor));
            }
            Kind::Read => c.reads += 1,
            Kind::Time { ms } => {
                c.time_ms_sum += ms;
                c.time_n += 1;
            }
            Kind::Play => c.plays += 1,
            Kind::Complete => c.completes += 1,
        }
    }
}

pub async fn flush(pool: &PgPool, b: Batch) -> sqlx::Result<()> {
    if b.len == 0 {
        return Ok(());
    }
    let mut tx = pool.begin().await?;

    // уникальные: новые хеши за день; сколько вставилось — столько и прибавляем
    let (va, vd, vv): (Vec<String>, Vec<NaiveDate>, Vec<Vec<u8>>) =
        b.visitors.into_iter().map(|(a, d, v)| (a, d, v.to_vec())).fold((vec![], vec![], vec![]), |mut acc, (a, d, v)| {
            acc.0.push(a);
            acc.1.push(d);
            acc.2.push(v);
            acc
        });
    let fresh: Vec<(String, NaiveDate)> = sqlx::query_as(
        "INSERT INTO article_visitors (article_id, day, visitor)
         SELECT * FROM UNNEST($1::text[], $2::date[], $3::bytea[])
         ON CONFLICT DO NOTHING RETURNING article_id, day",
    )
    .bind(&va)
    .bind(&vd)
    .bind(&vv)
    .fetch_all(&mut *tx)
    .await?;
    let mut uniques: HashMap<Key, i64> = HashMap::new();
    for k in fresh {
        *uniques.entry(k).or_default() += 1;
    }

    let mut a = vec![];
    let mut d = vec![];
    let (mut views, mut uq, mut anon, mut reads, mut tms, mut tn) = (vec![], vec![], vec![], vec![], vec![], vec![]);
    let (mut plays, mut completes) = (vec![], vec![]);
    for ((article, day), c) in &b.daily {
        a.push(article.clone());
        d.push(*day);
        views.push(c.views);
        uq.push(uniques.get(&(article.clone(), *day)).copied().unwrap_or(0));
        anon.push(c.anon_views);
        reads.push(c.reads);
        tms.push(c.time_ms_sum);
        tn.push(c.time_n);
        plays.push(c.plays);
        completes.push(c.completes);
    }
    sqlx::query(
        "INSERT INTO article_daily AS t (article_id, day, views, uniques, anon_views, reads, time_ms_sum, time_n, plays, completes)
         SELECT * FROM UNNEST($1::text[], $2::date[], $3::int8[], $4::int8[], $5::int8[], $6::int8[], $7::int8[], $8::int8[], $9::int8[], $10::int8[])
         ON CONFLICT (article_id, day) DO UPDATE SET
           views = t.views + EXCLUDED.views, uniques = t.uniques + EXCLUDED.uniques,
           anon_views = t.anon_views + EXCLUDED.anon_views, reads = t.reads + EXCLUDED.reads,
           time_ms_sum = t.time_ms_sum + EXCLUDED.time_ms_sum, time_n = t.time_n + EXCLUDED.time_n,
           plays = t.plays + EXCLUDED.plays, completes = t.completes + EXCLUDED.completes",
    )
    .bind(&a).bind(&d).bind(&views).bind(&uq).bind(&anon).bind(&reads).bind(&tms).bind(&tn).bind(&plays).bind(&completes)
    .execute(&mut *tx)
    .await?;

    if !b.sources.is_empty() {
        let (mut a, mut d, mut ch, mut nm, mut v) = (vec![], vec![], vec![], vec![], vec![]);
        for ((article, day, channel, name), n) in b.sources {
            a.push(article);
            d.push(day);
            ch.push(channel.to_string());
            nm.push(name);
            v.push(n);
        }
        sqlx::query(
            "INSERT INTO article_sources AS t (article_id, day, channel, name, views)
             SELECT * FROM UNNEST($1::text[], $2::date[], $3::text[], $4::text[], $5::int8[])
             ON CONFLICT (article_id, day, channel, name) DO UPDATE SET views = t.views + EXCLUDED.views",
        )
        .bind(&a).bind(&d).bind(&ch).bind(&nm).bind(&v)
        .execute(&mut *tx)
        .await?;
    }

    if !b.utm.is_empty() {
        let (mut a, mut d, mut s, mut m, mut c, mut v) = (vec![], vec![], vec![], vec![], vec![], vec![]);
        for ((article, day, u), n) in b.utm {
            a.push(article);
            d.push(day);
            s.push(u.source);
            m.push(u.medium);
            c.push(u.campaign);
            v.push(n);
        }
        sqlx::query(
            "INSERT INTO article_utm AS t (article_id, day, utm_source, utm_medium, utm_campaign, views)
             SELECT * FROM UNNEST($1::text[], $2::date[], $3::text[], $4::text[], $5::text[], $6::int8[])
             ON CONFLICT (article_id, day, utm_source, utm_medium, utm_campaign) DO UPDATE SET views = t.views + EXCLUDED.views",
        )
        .bind(&a).bind(&d).bind(&s).bind(&m).bind(&c).bind(&v)
        .execute(&mut *tx)
        .await?;
    }

    if !b.canvas.is_empty() {
        let (mut a, mut d, mut h, mut v) = (vec![], vec![], vec![], vec![]);
        for ((article, day, hash), n) in b.canvas {
            a.push(article);
            d.push(day);
            h.push(hash);
            v.push(n);
        }
        sqlx::query(
            "INSERT INTO article_canvas_fingerprints AS t (article_id, day, hash, views)
             SELECT * FROM UNNEST($1::text[], $2::date[], $3::text[], $4::int8[])
             ON CONFLICT (article_id, day, hash) DO UPDATE SET views = t.views + EXCLUDED.views",
        )
        .bind(&a).bind(&d).bind(&h).bind(&v)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await
}

/// Фоновый писатель: пакет по таймеру или по размеру. При ошибке БД пакет теряется (агрегаты, не деньги) — пишем в лог.
pub async fn run_writer(pool: PgPool, mut rx: mpsc::Receiver<Event>, every: Duration, max_batch: usize) {
    let mut batch = Batch::default();
    let mut tick = tokio::time::interval(every);
    loop {
        tokio::select! {
            ev = rx.recv() => match ev {
                Some(e) => {
                    batch.add(e);
                    if batch.len >= max_batch {
                        write(&pool, std::mem::take(&mut batch)).await;
                    }
                }
                None => {
                    write(&pool, std::mem::take(&mut batch)).await;
                    return;
                }
            },
            _ = tick.tick() => write(&pool, std::mem::take(&mut batch)).await,
        }
    }
}

async fn write(pool: &PgPool, b: Batch) {
    let n = b.len;
    if let Err(err) = flush(pool, b).await {
        tracing::error!(%err, events = n, "flush failed");
    }
}

/// хеши посетителей нужны только для текущего дня
pub async fn prune_visitors(pool: &PgPool, today: NaiveDate) -> sqlx::Result<u64> {
    Ok(sqlx::query("DELETE FROM article_visitors WHERE day < $1").bind(today.pred_opt().unwrap_or(today)).execute(pool).await?.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(kind: Kind) -> Event {
        Event { article_id: "a1".into(), day: NaiveDate::from_ymd_opt(2026, 11, 12).unwrap(), visitor: [1; 8], kind }
    }

    #[test]
    fn batch_folds_counters() {
        let mut b = Batch::default();
        let src = Source { channel: "search", name: "google.com".into() };
        b.add(ev(Kind::View { source: src.clone(), utm: None, anon: true, canvas: Some("ab".repeat(32)) }));
        b.add(ev(Kind::View { source: src, utm: Some(Utm { source: "tg".into(), medium: String::new(), campaign: "launch".into() }), anon: false, canvas: Some("ab".repeat(32)) }));
        b.add(ev(Kind::Read));
        b.add(ev(Kind::Time { ms: 30_000 }));
        b.add(ev(Kind::Play));
        b.add(ev(Kind::Complete));
        let c = b.daily.values().next().unwrap();
        assert_eq!(*c, Counters { views: 2, anon_views: 1, reads: 1, time_ms_sum: 30_000, time_n: 1, plays: 1, completes: 1 });
        assert_eq!(b.sources.values().sum::<i64>(), 2);
        assert_eq!(b.utm.len(), 1);
        assert_eq!(b.canvas.values().sum::<i64>(), 2);
        assert_eq!(b.visitors.len(), 1, "один посетитель");
    }

    #[test]
    fn dedupe_window() {
        let mut d = Dedupe::new(Duration::from_secs(1800));
        let t = Instant::now();
        assert!(d.fresh("a", [1; 8], t));
        assert!(!d.fresh("a", [1; 8], t + Duration::from_secs(60)), "перезагрузка не считается");
        assert!(d.fresh("b", [1; 8], t), "другая статья");
        assert!(d.fresh("a", [1; 8], t + Duration::from_secs(1801)), "после окна — новый просмотр");
    }

    #[test]
    fn dedupe_cap() {
        let mut d = Dedupe::with_cap(Duration::from_secs(60), 2);
        let t = Instant::now();
        assert!(d.fresh("a", [1; 8], t));
        assert!(d.fresh("b", [1; 8], t));
        assert!(!d.fresh("c", [1; 8], t), "таблица полна — отказ");
        assert!(d.fresh("c", [1; 8], t + Duration::from_secs(61)), "просроченные вычищены — место есть");
        assert!(d.seen.len() <= 2);
    }
}
