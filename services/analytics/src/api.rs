//! HTTP: POST /analytics-api/collect (beacon), GET /analytics-api/articles/{id}, /health.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Instant;

use axum::extract::{ConnectInfo, Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{Days, NaiveDate, Utc};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use sqlx::PgPool;
use tokio::sync::mpsc;

use crate::classify;
use crate::ingest::{Dedupe, Event, Kind, Utm};
use crate::ratelimit::RateLimit;

pub struct AppState {
    pub pool: PgPool,
    pub tx: mpsc::Sender<Event>,
    pub secret: Vec<u8>,
    pub own_hosts: Vec<String>,
    pub trust_proxy: bool,
    pub views: Mutex<Dedupe>,
    pub reads: Mutex<Dedupe>,
    pub times: Mutex<Dedupe>,
    /// запуск и досмотр видео: один на посетителя и статью за окно — перемотка в начало не накручивает
    pub plays: Mutex<Dedupe>,
    pub completes: Mutex<Dedupe>,
    pub limit: Mutex<RateLimit>,
}

/// отравленный мьютекс не валит сервис: данные — счётчики окон, берём как есть
pub fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub type Shared = Arc<AppState>;

pub fn router(state: Shared) -> Router {
    Router::new()
        .route("/analytics-api/health", get(|| async { Json(serde_json::json!({ "ok": true })) }))
        .route("/analytics-api/collect", post(collect))
        .route("/analytics-api/articles/{id}", get(article_stats))
        .route("/analytics-api/completions", get(completions))
        .with_state(state)
}

#[derive(Deserialize)]
pub struct UtmIn {
    source: String,
    #[serde(default)]
    medium: String,
    #[serde(default)]
    campaign: String,
}

/// Компактный beacon: { a, k, ms?, r?, u?, auth? }
#[derive(Deserialize)]
pub struct Collect {
    a: String,
    k: String,
    ms: Option<i64>,
    r: Option<String>,
    u: Option<UtmIn>,
    #[serde(default)]
    auth: bool,
}

/// id статьи: AT URI `at://did:<method>:<id>/media.weat.article/<rkey>`, id из индекса (rkey-хвост DID) или локальный (u-…)
fn valid_article(id: &str) -> bool {
    if let Some(rest) = id.strip_prefix("at://did:") {
        return id.len() <= 300 && valid_at(rest);
    }
    let b = id.as_bytes();
    // первым может быть цифра: id статьи из индекса — rkey (TID, «3n26…») и хвост DID, как remoteId на сайте
    (1..=32).contains(&b.len()) && b[0].is_ascii_alphanumeric() && !b[0].is_ascii_uppercase() && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_' || *c == b'-')
}

fn valid_at(rest: &str) -> bool {
    let Some((did, rkey)) = rest.split_once("/media.weat.article/") else { return false };
    let Some((method, ident)) = did.split_once(':') else { return false };
    let rk = |c: char| c.is_ascii_alphanumeric() || "._:~-".contains(c);
    !method.is_empty()
        && method.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && !ident.is_empty()
        && ident.chars().all(|c| c.is_ascii_alphanumeric() || "._:%-".contains(c))
        && (1..=64).contains(&rkey.len())
        && rkey.chars().all(rk)
}

fn clip(s: &str, n: usize) -> String {
    s.trim().chars().take(n).collect()
}

/// Дневной хеш посетителя: HMAC(secret, день | IP | UA), 8 байт. IP и UA не сохраняются;
/// с новым днём хеш другой — связать визиты разных дней нельзя.
pub fn visitor_hash(secret: &[u8], day: NaiveDate, ip: &str, ua: &str) -> [u8; 8] {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).expect("hmac key");
    mac.update(day.to_string().as_bytes());
    mac.update(b"|");
    mac.update(ip.as_bytes());
    mac.update(b"|");
    mac.update(ua.as_bytes());
    let out = mac.finalize().into_bytes();
    let mut v = [0u8; 8];
    v.copy_from_slice(&out[..8]);
    v
}

fn client_ip(s: &AppState, headers: &HeaderMap, peer: SocketAddr) -> String {
    pick_ip(s.trust_proxy, headers, peer)
}

fn pick_ip(trust_proxy: bool, headers: &HeaderMap, peer: SocketAddr) -> String {
    if trust_proxy {
        // берём ПОСЛЕДНИЙ адрес: его дописал наш Caddy; левые клиент подставляет сам
        if let Some(ip) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()).and_then(|v| v.rsplit(',').next()).map(str::trim).filter(|v| !v.is_empty()) {
            return ip.to_string();
        }
    }
    peer.ip().to_string()
}

/// sendBeacon шлёт text/plain — тело разбираем как JSON независимо от content-type
async fn collect(State(s): State<Shared>, ConnectInfo(peer): ConnectInfo<SocketAddr>, headers: HeaderMap, body: String) -> StatusCode {
    let Ok(c) = serde_json::from_str::<Collect>(&body) else { return StatusCode::BAD_REQUEST };
    if !valid_article(&c.a) {
        return StatusCode::BAD_REQUEST;
    }
    let ua = headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok()).unwrap_or("");
    // DNT/GPC уважаем: такие визиты не считаем вовсе
    let opted_out = headers.get("dnt").is_some_and(|v| v == "1") || headers.get("sec-gpc").is_some_and(|v| v == "1");
    if classify::is_bot(ua) || opted_out {
        return StatusCode::NO_CONTENT;
    }
    let ip = client_ip(&s, &headers, peer);
    let now = Instant::now();
    if !lock(&s.limit).allow(&ip, now) {
        return StatusCode::TOO_MANY_REQUESTS;
    }
    let day = Utc::now().date_naive();
    let visitor = visitor_hash(&s.secret, day, &ip, ua);

    let kind = match c.k.as_str() {
        "view" => {
            if !lock(&s.views).fresh(&c.a, visitor, now) {
                return StatusCode::NO_CONTENT;
            }
            let utm = c.u.filter(|u| !u.source.trim().is_empty()).map(|u| Utm {
                source: clip(&u.source, 100),
                medium: clip(&u.medium, 100),
                campaign: clip(&u.campaign, 100),
            });
            Kind::View { source: classify::source(c.r.as_deref(), &s.own_hosts), utm, anon: !c.auth }
        }
        "read" => {
            if !lock(&s.reads).fresh(&c.a, visitor, now) {
                return StatusCode::NO_CONTENT;
            }
            Kind::Read
        }
        "play" => {
            if !lock(&s.plays).fresh(&c.a, visitor, now) {
                return StatusCode::NO_CONTENT;
            }
            Kind::Play
        }
        "complete" => {
            if !lock(&s.completes).fresh(&c.a, visitor, now) {
                return StatusCode::NO_CONTENT;
            }
            Kind::Complete
        }
        // время на странице: от 1 с до 2 ч, иначе вкладка висела в фоне
        "time" => match c.ms {
            // одно время на посетителя и статью за окно — иначе avg_time накручивается
            Some(ms) if (1_000..=7_200_000).contains(&ms) => {
                if !lock(&s.times).fresh(&c.a, visitor, now) {
                    return StatusCode::NO_CONTENT;
                }
                Kind::Time { ms }
            }
            _ => return StatusCode::BAD_REQUEST,
        },
        _ => return StatusCode::BAD_REQUEST,
    };
    // очередь полна — событие теряем, а не тормозим читателя
    match s.tx.try_send(Event { article_id: c.a, day, visitor, kind }) {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::SERVICE_UNAVAILABLE,
    }
}

#[derive(Serialize, sqlx::FromRow)]
pub struct CompletionOut {
    id: String,
    plays: i64,
    completes: i64,
}

/// досмотры видео за days дней (по умолчанию 14 — окно hot) — их забирает ранжирование ленты (services/feed)
async fn completions(State(s): State<Shared>, Query(q): Query<StatsQuery>) -> Response {
    let days = q.days.unwrap_or(14).clamp(1, 90);
    let since = Utc::now().date_naive().checked_sub_days(Days::new(u64::from(days - 1))).unwrap_or_default();
    let rows: sqlx::Result<Vec<CompletionOut>> = sqlx::query_as(
        "SELECT article_id AS id, sum(plays)::int8 AS plays, sum(completes)::int8 AS completes
         FROM article_daily WHERE day >= $1 GROUP BY article_id HAVING sum(plays) > 0
         ORDER BY completes DESC LIMIT 10000",
    )
    .bind(since)
    .fetch_all(&s.pool)
    .await;
    match rows {
        Ok(items) => ([(header::CACHE_CONTROL, "public, max-age=60")], Json(serde_json::json!({ "items": items }))).into_response(),
        Err(err) => {
            tracing::error!(%err, "completions");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct StatsQuery {
    days: Option<u32>,
}

#[derive(Serialize, Default)]
pub struct DayOut {
    day: NaiveDate,
    views: i64,
    uniques: i64,
    reads: i64,
}

#[derive(Serialize)]
pub struct SourceOut {
    channel: String,
    name: String,
    views: i64,
}

#[derive(Serialize)]
pub struct UtmOut {
    source: String,
    medium: String,
    campaign: String,
    views: i64,
}

#[derive(Serialize)]
pub struct Stats {
    article_id: String,
    since: NaiveDate,
    views: i64,
    uniques: i64,
    anon_views: i64,
    reads: i64,
    avg_time_ms: i64,
    daily: Vec<DayOut>,
    sources: Vec<SourceOut>,
    utm: Vec<UtmOut>,
}

async fn article_stats(State(s): State<Shared>, Path(id): Path<String>, Query(q): Query<StatsQuery>) -> Response {
    if !valid_article(&id) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let days = q.days.unwrap_or(14).clamp(1, 90);
    let today = Utc::now().date_naive();
    let since = today.checked_sub_days(Days::new(u64::from(days - 1))).unwrap_or(today);
    match load_stats(&s.pool, &id, since, today).await {
        Ok(st) => ([(header::CACHE_CONTROL, "public, max-age=30")], Json(st)).into_response(),
        Err(err) => {
            tracing::error!(%err, "stats");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

type DailyRow = (NaiveDate, i64, i64, i64, i64, i64, i64);

pub async fn load_stats(pool: &PgPool, id: &str, since: NaiveDate, today: NaiveDate) -> sqlx::Result<Stats> {
    let rows: Vec<DailyRow> = sqlx::query_as(
        "SELECT day, views, uniques, anon_views, reads, time_ms_sum, time_n FROM article_daily
         WHERE article_id = $1 AND day >= $2 ORDER BY day",
    )
    .bind(id)
    .bind(since)
    .fetch_all(pool)
    .await?;
    let sources: Vec<(String, String, i64)> = sqlx::query_as(
        // имена «other» — произвольные хосты из тела beacon: публично не показываем, сворачиваем в одну строку
        "SELECT channel, CASE WHEN channel = 'other' THEN '' ELSE name END, sum(views)::int8 FROM article_sources WHERE article_id = $1 AND day >= $2
         GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20",
    )
    .bind(id)
    .bind(since)
    .fetch_all(pool)
    .await?;
    let utm: Vec<(String, String, String, i64)> = sqlx::query_as(
        "SELECT utm_source, utm_medium, utm_campaign, sum(views)::int8 FROM article_utm WHERE article_id = $1 AND day >= $2
         GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 20",
    )
    .bind(id)
    .bind(since)
    .fetch_all(pool)
    .await?;

    // пустые дни — нулями, чтобы график был непрерывным
    let mut daily = vec![];
    let mut d = since;
    while d <= today {
        let r = rows.iter().find(|r| r.0 == d);
        daily.push(DayOut { day: d, views: r.map_or(0, |r| r.1), uniques: r.map_or(0, |r| r.2), reads: r.map_or(0, |r| r.4) });
        d = d.succ_opt().unwrap();
    }
    let sum = |f: fn(&DailyRow) -> i64| rows.iter().map(f).sum::<i64>();
    let (time_sum, time_n) = (sum(|r| r.5), sum(|r| r.6));
    Ok(Stats {
        article_id: id.to_string(),
        since,
        views: sum(|r| r.1),
        uniques: sum(|r| r.2),
        anon_views: sum(|r| r.3),
        reads: sum(|r| r.4),
        avg_time_ms: if time_n > 0 { time_sum / time_n } else { 0 },
        daily,
        sources: sources.into_iter().map(|(channel, name, views)| SourceOut { channel, name, views }).collect(),
        utm: utm.into_iter().map(|(source, medium, campaign, views)| UtmOut { source, medium, campaign, views }).collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn visitor_hash_rotates_daily() {
        let d1 = NaiveDate::from_ymd_opt(2026, 11, 12).unwrap();
        let d2 = d1.succ_opt().unwrap();
        let a = visitor_hash(b"k", d1, "1.2.3.4", "UA");
        assert_eq!(a, visitor_hash(b"k", d1, "1.2.3.4", "UA"));
        assert_ne!(a, visitor_hash(b"k", d2, "1.2.3.4", "UA"), "новый день — новый хеш");
        assert_ne!(a, visitor_hash(b"k", d1, "1.2.3.5", "UA"));
    }

    #[test]
    fn article_ids() {
        assert!(valid_article("a12"));
        assert!(valid_article("demo_post-1"));
        assert!(valid_article("at://did:plc:abc/media.weat.article/3n24"));
        assert!(valid_article("at://did:web:weat.media/media.weat.article/3k2a.b~c"));
        assert!(!valid_article(""));
        assert!(!valid_article("A12"), "локальный id — строчные");
        assert!(valid_article("3n26tekng4k2f-o4auyh"), "id статьи из индекса: rkey-хвост DID");
        assert!(!valid_article("-abc"));
        assert!(!valid_article(&format!("a{}", "b".repeat(32))), "длиннее 32");
        assert!(!valid_article("at://did:plc:abc/app.bsky.feed.post/3n24"), "чужая коллекция");
        assert!(!valid_article("at://did:plc:abc/media.weat.article/"));
        assert!(!valid_article(&format!("at://did:plc:abc/media.weat.article/{}", "x".repeat(65))));
        assert!(!valid_article("at://did::abc/media.weat.article/x"));
        assert!(!valid_article("random/string.with:chars"));
        assert!(!valid_article("a b"));
        assert!(!valid_article("<script>"));
    }

    #[test]
    fn xff_rightmost() {
        let mut h = HeaderMap::new();
        h.insert("x-forwarded-for", "6.6.6.6, 1.2.3.4".parse().unwrap());
        let peer: SocketAddr = "10.0.0.1:1".parse().unwrap();
        assert_eq!(pick_ip(true, &h, peer), "1.2.3.4", "клиентский префикс игнорируем");
        assert_eq!(pick_ip(false, &h, peer), "10.0.0.1");
    }
}
