//! HTTP: GET /feed-api/articles (лента с фильтрами и keyset-курсором), /feed-api/health.

use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use sqlx::PgPool;

use crate::index;
use crate::rank::Sort;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    /// публичный адрес сайта — для ссылок в RSS
    pub site_url: String,
    pub site_name: String,
    /// готовые ответы hot, best и related (cache.rs)
    pub cache: std::sync::Arc<crate::cache::Cache>,
    /// FEED_ADMIN_TOKEN: белый список standard.site меняет только AppView (админка); None — маршрутов нет
    pub admin_token: Option<String>,
}

/// медленнее этого — warn в лог: сигнал, что пора предрасчитывать score (см. rank.rs)
const SLOW: std::time::Duration = std::time::Duration::from_millis(100);

/// JSON из кэша или свежий; x-cache: hit | miss, время запроса к базе — в лог
fn json_body(body: String, cache_control: &'static str, hit: bool) -> Response {
    (
        [
            (header::CONTENT_TYPE, "application/json"),
            (header::CACHE_CONTROL, cache_control),
            (
                header::HeaderName::from_static("x-cache"),
                if hit { "hit" } else { "miss" },
            ),
        ],
        body,
    )
        .into_response()
}

fn log_timing(what: &str, key: &str, elapsed: std::time::Duration, rows: usize) {
    let ms = elapsed.as_secs_f64() * 1000.0;
    if elapsed >= SLOW {
        tracing::warn!(what, key, ms, rows, "slow ranked query");
    } else {
        tracing::info!(what, key, ms, rows, "ranked query");
    }
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route(
            "/feed-api/health",
            get(|| async { Json(serde_json::json!({ "ok": true })) }),
        )
        .route("/feed-api/articles", get(articles))
        .route("/feed-api/article", get(one))
        .route("/feed-api/likes", get(likes))
        .route("/feed-api/comments", get(comments))
        .route("/feed-api/related", get(related))
        .route("/feed-api/stream", get(stream))
        .route("/rss/author/{handle}", get(crate::rss::author))
        .route("/rss/comments/{did}/{rkey}", get(crate::rss::comments))
        .route(
            "/feed-api/admin/standard",
            get(standard_list)
                .post(standard_allow)
                .delete(standard_disallow),
        )
        .route("/feed-api/admin/standard/platforms", get(platforms_list).put(platform_set))
        .route("/feed-api/admin/standard/block", get(block_list).post(block_add).delete(block_remove))
        .with_state(state)
}

#[derive(Deserialize, Default)]
pub struct Params {
    limit: Option<i64>,
    cursor: Option<String>,
    /// страницы с номером в адресе; keyset-курсор приоритетнее
    offset: Option<i64>,
    /// tags=rust,linux
    tags: Option<String>,
    lang: Option<String>,
    /// internal | external
    source: Option<String>,
    author: Option<String>,
    /// full — записи целиком (по умолчанию карточки без текста)
    view: Option<String>,
    /// new | hot | best (см. rank.rs)
    sort: Option<String>,
    /// для best: likes | comments
    metric: Option<String>,
    /// для best: day | week | month | all
    period: Option<String>,
    /// video | text — только видео-записи или только тексты
    kind: Option<String>,
}

/// курсор — позиция последней записи страницы: base64url("<микросекунды>|<uri>")
pub fn encode_cursor(at: DateTime<Utc>, uri: &str) -> String {
    URL_SAFE_NO_PAD.encode(format!("{}|{uri}", at.timestamp_micros()))
}
pub fn decode_cursor(c: &str) -> Option<(DateTime<Utc>, String)> {
    let raw = String::from_utf8(URL_SAFE_NO_PAD.decode(c).ok()?).ok()?;
    let (us, uri) = raw.split_once('|')?;
    Some((
        DateTime::from_timestamp_micros(us.parse().ok()?)?,
        uri.to_string(),
    ))
}

/// курсор hot и best — смещение: base64url("off|<n>")
pub fn encode_offset(n: i64) -> String {
    URL_SAFE_NO_PAD.encode(format!("off|{n}"))
}
pub fn decode_offset(c: &str) -> Option<i64> {
    let raw = String::from_utf8(URL_SAFE_NO_PAD.decode(c).ok()?).ok()?;
    raw.strip_prefix("off|")?
        .parse()
        .ok()
        .filter(|n| (0..=10_000).contains(n))
}

pub fn to_query(p: Params) -> Result<index::Query, &'static str> {
    let sort = Sort::parse(p.sort.as_deref(), p.metric.as_deref(), p.period.as_deref())?;
    let (after, offset) = match (p.cursor.as_deref(), sort) {
        (None, _) => (None, p.offset.unwrap_or(0).clamp(0, 10_000)),
        (Some(c), Sort::New) => (Some(decode_cursor(c).ok_or("bad cursor")?), 0),
        (Some(c), _) => (None, decode_offset(c).ok_or("bad cursor")?),
    };
    let tags: Vec<String> = p
        .tags
        .unwrap_or_default()
        .split(',')
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty() && t.len() <= 64)
        .take(20)
        .collect();
    let external = match p.source.as_deref() {
        None | Some("") | Some("all") => None,
        Some("external") => Some(true),
        Some("internal") => Some(false),
        Some(_) => return Err("source: all | internal | external"),
    };
    let lang = p.lang.filter(|l| l != "all" && l.len() <= 10);
    let did = p.author.filter(|a| a.starts_with("did:") && a.len() <= 200);
    let full = p.view.as_deref() == Some("full");
    let kind = match p.kind.as_deref() {
        None | Some("") | Some("all") => None,
        Some("video") => Some("video"),
        Some("text") => Some("text"),
        Some(_) => return Err("kind: all | video | text"),
    };
    Ok(index::Query {
        limit: p.limit.unwrap_or(30).clamp(1, 100),
        after,
        tags,
        lang,
        external,
        did,
        full,
        sort,
        kind,
        offset,
    })
}

async fn articles(State(s): State<AppState>, Query(mut p): Query<Params>) -> Response {
    let pool = s.pool;
    if let Some(author) = p.author.as_deref() {
        if !author.starts_with("did:") {
            p.author = match index::did_by_handle(&pool, author).await {
                Ok(did) => did,
                Err(err) => {
                    tracing::error!(%err, "author lookup");
                    return StatusCode::INTERNAL_SERVER_ERROR.into_response();
                }
            };
            if p.author.is_none() {
                return Json(serde_json::json!({ "articles": [], "cursor": null, "total": 0 }))
                    .into_response();
            }
        }
    }
    let q = match to_query(p) {
        Ok(q) => q,
        Err(msg) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "InvalidRequest", "message": msg })),
            )
                .into_response();
        }
    };
    // new — дешёвый keyset и должен быть свежим; кэшируем только ранжирование
    let cache_key = (q.sort != Sort::New).then(|| format!("feed:{q:?}"));
    let now = std::time::Instant::now();
    if let Some(body) = cache_key
        .as_deref()
        .and_then(|k| s.cache.get(k, crate::cache::RANKED_TTL, now))
    {
        return json_body(body, "public, max-age=5", true);
    }
    match tokio::join!(index::feed(&pool, &q), index::count(&pool, &q)) {
        (Ok(rows), Ok(total)) => {
            if let Some(key) = &cache_key {
                log_timing("feed", key, now.elapsed(), rows.len());
            }
            let full_page = rows.len() as i64 == q.limit;
            let cursor = match q.sort {
                Sort::New => full_page
                    .then(|| rows.last().map(|r| encode_cursor(r.created_at, &r.uri)))
                    .flatten(),
                _ => full_page.then(|| encode_offset(q.offset + q.limit)),
            };
            let body = serde_json::json!({ "articles": rows, "cursor": cursor, "total": total })
                .to_string();
            if let Some(key) = cache_key {
                s.cache
                    .put(key, body.clone(), crate::cache::RANKED_TTL, now);
            }
            json_body(body, "public, max-age=5", false)
        }
        (Err(err), _) | (_, Err(err)) => {
            tracing::error!(%err, "feed query");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct One {
    uri: Option<String>,
    /// короткий id страницы статьи: <rkey>-<6 последних символов DID> (для превью ссылок)
    short: Option<String>,
}

/// одна статья целиком — для страницы статьи
async fn one(State(s): State<AppState>, Query(q): Query<One>) -> Response {
    let uri = match (q.uri, q.short) {
        (Some(uri), _) if uri.starts_with("at://did:") && uri.len() <= 400 => uri,
        (None, Some(short)) if short.len() <= 80 => {
            let Some((rkey, tail)) = short.rsplit_once('-') else {
                return StatusCode::BAD_REQUEST.into_response();
            };
            if tail.len() != 6 || rkey.is_empty() {
                return StatusCode::BAD_REQUEST.into_response();
            }
            match index::uri_by_short(&s.pool, rkey, tail).await {
                Ok(Some(uri)) => uri,
                Ok(None) => return StatusCode::NOT_FOUND.into_response(),
                Err(err) => {
                    tracing::error!(%err, "article short");
                    return StatusCode::INTERNAL_SERVER_ERROR.into_response();
                }
            }
        }
        _ => return StatusCode::BAD_REQUEST.into_response(),
    };
    match index::article(&s.pool, &uri).await {
        Ok(Some(row)) => {
            ([(header::CACHE_CONTROL, "public, max-age=30")], Json(row)).into_response()
        }
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(err) => {
            tracing::error!(%err, "article");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct RelatedParams {
    uri: String,
    limit: Option<i64>,
    /// video | text
    kind: Option<String>,
}

/// «Читать дальше»: общие теги и общие читатели (rank::related_sql)
async fn related(State(s): State<AppState>, Query(p): Query<RelatedParams>) -> Response {
    if !p.uri.starts_with("at://did:") || p.uri.len() > 400 {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let limit = p.limit.unwrap_or(3).clamp(1, 20);
    let kind = match p.kind.as_deref() {
        Some("video") => Some("video"),
        Some("text") => Some("text"),
        _ => None,
    };
    let key = format!("related:{}:{limit}:{kind:?}", p.uri);
    let now = std::time::Instant::now();
    if let Some(body) = s.cache.get(&key, crate::cache::RELATED_TTL, now) {
        return json_body(body, "public, max-age=60", true);
    }
    match index::related(&s.pool, &p.uri, limit, kind).await {
        Ok(rows) => {
            log_timing("related", &key, now.elapsed(), rows.len());
            let body = serde_json::json!({ "articles": rows }).to_string();
            s.cache
                .put(key, body.clone(), crate::cache::RELATED_TTL, now);
            json_body(body, "public, max-age=60", false)
        }
        Err(err) => {
            tracing::error!(%err, "related");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct CommentsParams {
    /// at://… статьи — тред
    subject: Option<String>,
    /// DID — комментарии пользователя (профиль)
    author: Option<String>,
    limit: Option<i64>,
}

/// subject — тред статьи по возрастанию времени (ответы ссылаются на parent);
/// author — комментарии пользователя, новые сверху, с заголовком статьи
async fn comments(State(s): State<AppState>, Query(p): Query<CommentsParams>) -> Response {
    let rows = match (p.subject.as_deref(), p.author.as_deref()) {
        (Some(subject), None) if subject.starts_with("at://did:") && subject.len() <= 400 => {
            let limit = p.limit.unwrap_or(500).clamp(1, 1000);
            index::comments_of(&s.pool, subject, limit, false)
                .await
                .map(|r| serde_json::json!({ "comments": r }))
        }
        (None, Some(did)) if did.starts_with("did:") && did.len() <= 200 => {
            let limit = p.limit.unwrap_or(50).clamp(1, 200);
            index::comments_by(&s.pool, did, limit)
                .await
                .map(|r| serde_json::json!({ "comments": r }))
        }
        _ => return StatusCode::BAD_REQUEST.into_response(),
    };
    match rows {
        Ok(body) => ([(header::CACHE_CONTROL, "public, max-age=5")], Json(body)).into_response(),
        Err(err) => {
            tracing::error!(%err, "comments");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct LikesParams {
    did: String,
    /// subjects=at://…,at://…
    subjects: String,
}

pub fn parse_subjects(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(str::trim)
        .filter(|u| u.starts_with("at://did:") && u.len() <= 400)
        .take(200)
        .map(str::to_string)
        .collect()
}

/// лайки пользователя на статьях из списка — состояние кнопки и rkey для снятия
async fn likes(State(s): State<AppState>, Query(p): Query<LikesParams>) -> Response {
    if !p.did.starts_with("did:") || p.did.len() > 200 {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let subjects = parse_subjects(&p.subjects);
    match index::likes_of(&s.pool, &p.did, &subjects).await {
        Ok(rows) => (
            [(header::CACHE_CONTROL, "private, no-store")],
            Json(serde_json::json!({ "likes": rows })),
        )
            .into_response(),
        Err(err) => {
            tracing::error!(%err, "likes");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranked_params_use_offset_cursor() {
        let q = to_query(Params {
            sort: Some("hot".into()),
            cursor: Some(encode_offset(60)),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(
            (q.sort, q.offset, q.after.is_none()),
            (
                Sort::Hot {
                    days: crate::rank::HOT_WINDOW_DAYS
                },
                60,
                true
            )
        );
        // курсор времени к hot не подходит
        let t = encode_cursor(Utc::now(), "at://did:plc:x/media.weat.article/1");
        assert!(
            to_query(Params {
                sort: Some("hot".into()),
                cursor: Some(t),
                ..Default::default()
            })
            .is_err()
        );
        assert!(decode_offset(&encode_offset(20_000)).is_none());
        assert!(
            to_query(Params {
                sort: Some("top".into()),
                ..Default::default()
            })
            .is_err()
        );
    }

    #[test]
    fn subjects_filtered() {
        assert_eq!(
            parse_subjects(
                "at://did:plc:a/media.weat.article/1, https://x,,at://did:plc:b/media.weat.article/2"
            ),
            vec![
                "at://did:plc:a/media.weat.article/1",
                "at://did:plc:b/media.weat.article/2"
            ]
        );
    }

    #[test]
    fn cursor_roundtrip_and_params() {
        let at = DateTime::parse_from_rfc3339("2026-11-12T10:00:00.123456Z")
            .unwrap()
            .with_timezone(&Utc);
        let c = encode_cursor(at, "at://did:plc:x/media.weat.article/3k");
        assert_eq!(
            decode_cursor(&c),
            Some((at, "at://did:plc:x/media.weat.article/3k".into()))
        );
        assert!(decode_cursor("!!!").is_none());
        let q = to_query(Params {
            tags: Some("rust, ,linux".into()),
            source: Some("external".into()),
            limit: Some(500),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(q.tags, vec!["rust", "linux"]);
        assert_eq!(q.external, Some(true));
        assert_eq!(q.limit, 100);
        assert!(
            to_query(Params {
                source: Some("x".into()),
                ..Default::default()
            })
            .is_err()
        );
    }

    #[test]
    fn fuzz_did_validation() {
        let mut seed = 0x243f6a8885a308d3u64;
        for _ in 0..10_000 {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            let value = format!(
                "did:plc:{seed:x}\0\u{202e}{}",
                "a".repeat((seed as usize) % 256)
            );
            if valid_did(&value) {
                assert!(value.len() <= 200);
                assert!(
                    value
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b".:-_%".contains(&b))
                );
            }
        }
    }
}

/// сравнение токена за постоянное время
fn admin_ok(s: &AppState, headers: &HeaderMap) -> bool {
    let Some(want) = s.admin_token.as_deref().filter(|t| !t.is_empty()) else {
        return false;
    };
    let got = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    got.len() == want.len()
        && got
            .bytes()
            .zip(want.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

fn valid_did(did: &str) -> bool {
    did.len() <= 200
        && (did.starts_with("did:plc:") || did.starts_with("did:web:"))
        && did
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".:-_%".contains(&b))
}

#[derive(Deserialize)]
struct AllowBody {
    did: String,
    note: Option<String>,
}

#[derive(Deserialize)]
struct DidQuery {
    did: String,
}

async fn standard_list(State(s): State<AppState>, headers: HeaderMap) -> Response {
    if !admin_ok(&s, &headers) {
        return StatusCode::NOT_FOUND.into_response();
    }
    match crate::standard::list_allowed(&s.pool).await {
        Ok(rows) => ([(header::CACHE_CONTROL, "no-store")], Json(rows)).into_response(),
        Err(err) => {
            tracing::error!(%err, "standard list");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn standard_allow(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(b): Json<AllowBody>,
) -> Response {
    if !admin_ok(&s, &headers) {
        return StatusCode::NOT_FOUND.into_response();
    }
    if !valid_did(&b.did) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let note = b
        .note
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(|n| n.chars().take(200).collect::<String>());
    match crate::standard::allow(&s.pool, &b.did, note.as_deref()).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => {
            tracing::error!(%err, "standard allow");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn standard_disallow(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<DidQuery>,
) -> Response {
    if !admin_ok(&s, &headers) {
        return StatusCode::NOT_FOUND.into_response();
    }
    if !valid_did(&q.did) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    match crate::standard::disallow(&s.pool, &q.did).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => {
            tracing::error!(%err, "standard disallow");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// SSE: новые, изменённые и удалённые статьи индекса. Подписчик, который не успевает, получает
/// событие `lagged` (часть пропущена — перечитать ленту) и продолжает с текущих событий.
async fn stream() -> axum::response::sse::Sse<impl futures_util::Stream<Item = Result<axum::response::sse::Event, std::convert::Infallible>>> {
    use axum::response::sse::{Event, KeepAlive, Sse};
    use tokio::sync::broadcast::error::RecvError;
    let rx = crate::events::subscribe();
    let events = futures_util::stream::unfold(rx, |mut rx| async move {
        let ev = match rx.recv().await {
            Ok(ev) => {
                let data = serde_json::to_string(&ev).unwrap_or_default();
                Event::default().event(ev.kind).id(ev.at.timestamp_micros().to_string()).data(data)
            }
            Err(RecvError::Lagged(n)) => Event::default().event("lagged").data(format!("{{\"missed\":{n}}}")),
            Err(RecvError::Closed) => return None,
        };
        Some((Ok(ev), rx))
    });
    Sse::new(events).keep_alive(KeepAlive::new().interval(std::time::Duration::from_secs(20)))
}

fn internal(err: sqlx::Error, what: &str) -> Response {
    tracing::error!(%err, what);
    StatusCode::INTERNAL_SERVER_ERROR.into_response()
}

async fn platforms_list(State(s): State<AppState>, headers: HeaderMap) -> Response {
    if !admin_ok(&s, &headers) {
        return StatusCode::NOT_FOUND.into_response();
    }
    match crate::standard::list_platforms(&s.pool).await {
        Ok(rows) => ([(header::CACHE_CONTROL, "no-store")], Json(rows)).into_response(),
        Err(err) => internal(err, "platforms list"),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlatformBody {
    content_type: String,
    enabled: bool,
}

async fn platform_set(State(s): State<AppState>, headers: HeaderMap, Json(b): Json<PlatformBody>) -> Response {
    if !admin_ok(&s, &headers) {
        return StatusCode::NOT_FOUND.into_response();
    }
    match crate::standard::set_platform(&s.pool, &b.content_type, b.enabled).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(err) => internal(err, "platform set"),
    }
}

async fn block_list(State(s): State<AppState>, headers: HeaderMap) -> Response {
    if !admin_ok(&s, &headers) {
        return StatusCode::NOT_FOUND.into_response();
    }
    match crate::standard::list_blocked(&s.pool).await {
        Ok(rows) => ([(header::CACHE_CONTROL, "no-store")], Json(rows)).into_response(),
        Err(err) => internal(err, "block list"),
    }
}

async fn block_add(State(s): State<AppState>, headers: HeaderMap, Json(b): Json<AllowBody>) -> Response {
    if !admin_ok(&s, &headers) {
        return StatusCode::NOT_FOUND.into_response();
    }
    if !valid_did(&b.did) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let note = b.note.as_deref().map(str::trim).filter(|n| !n.is_empty()).map(|n| n.chars().take(200).collect::<String>());
    match crate::standard::block(&s.pool, &b.did, note.as_deref()).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => internal(err, "block add"),
    }
}

async fn block_remove(State(s): State<AppState>, headers: HeaderMap, Query(q): Query<DidQuery>) -> Response {
    if !admin_ok(&s, &headers) {
        return StatusCode::NOT_FOUND.into_response();
    }
    if !valid_did(&q.did) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    match crate::standard::unblock(&s.pool, &q.did).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => internal(err, "block remove"),
    }
}
