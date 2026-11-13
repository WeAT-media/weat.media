//! HTTP: GET /feed-api/articles (лента с фильтрами и keyset-курсором), /feed-api/health.

use axum::extract::{Query, State};
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
        .route("/rss/author/{handle}", get(crate::rss::author))
        .route("/rss/comments/{did}/{rkey}", get(crate::rss::comments))
        .with_state(state)
}

#[derive(Deserialize, Default)]
pub struct Params {
    limit: Option<i64>,
    cursor: Option<String>,
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
        (None, _) => (None, 0),
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
    Ok(index::Query {
        limit: p.limit.unwrap_or(30).clamp(1, 100),
        after,
        tags,
        lang,
        external,
        did,
        full,
        sort,
        offset,
    })
}

async fn articles(State(s): State<AppState>, Query(p): Query<Params>) -> Response {
    let pool = s.pool;
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
    match index::feed(&pool, &q).await {
        Ok(rows) => {
            let full_page = rows.len() as i64 == q.limit;
            let cursor = match q.sort {
                Sort::New => full_page
                    .then(|| rows.last().map(|r| encode_cursor(r.created_at, &r.uri)))
                    .flatten(),
                _ => full_page.then(|| encode_offset(q.offset + q.limit)),
            };
            (
                [(header::CACHE_CONTROL, "public, max-age=5")],
                Json(serde_json::json!({ "articles": rows, "cursor": cursor })),
            )
                .into_response()
        }
        Err(err) => {
            tracing::error!(%err, "feed query");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct One {
    uri: String,
}

/// одна статья целиком — для страницы статьи
async fn one(State(s): State<AppState>, Query(q): Query<One>) -> Response {
    if !q.uri.starts_with("at://did:") || q.uri.len() > 400 {
        return StatusCode::BAD_REQUEST.into_response();
    }
    match index::article(&s.pool, &q.uri).await {
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
        assert_eq!((q.sort, q.offset, q.after.is_none()), (Sort::Hot, 60, true));
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
}
