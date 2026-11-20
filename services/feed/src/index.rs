//! Postgres: запись индекса и выдача ленты.

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::PgPool;

use crate::record::{Article, CommentRec, LikeRec};

pub async fn upsert(
    pool: &PgPool,
    uri: &str,
    did: &str,
    rkey: &str,
    cid: &str,
    a: &Article,
    record: &Value,
) -> sqlx::Result<()> {
    let inserted = sqlx::query(
        "INSERT INTO articles (uri, did, rkey, cid, created_at, title, tags, langs, source_site, paid, record, published_at, kind)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (uri) DO UPDATE SET cid = EXCLUDED.cid, created_at = EXCLUDED.created_at, published_at = EXCLUDED.published_at, kind = EXCLUDED.kind, title = EXCLUDED.title,
           tags = EXCLUDED.tags, langs = EXCLUDED.langs, source_site = EXCLUDED.source_site, paid = EXCLUDED.paid,
           record = EXCLUDED.record, indexed_at = now()
         WHERE articles.cid IS DISTINCT FROM EXCLUDED.cid
         RETURNING (xmax = 0) AS inserted",
    )
    .bind(uri)
    .bind(did)
    .bind(rkey)
    .bind(cid)
    .bind(a.created_at)
    .bind(&a.title)
    .bind(&a.tags)
    .bind(&a.langs)
    .bind(&a.source_site)
    .bind(a.paid)
    .bind(record)
    .bind(a.published_at)
    .bind(if a.video { "video" } else { "text" })
    .fetch_optional(pool)
    .await?;
    // None — та же версия (тот же CID): ничего не изменилось, события нет
    if let Some(row) = inserted {
        let inserted: bool = sqlx::Row::get(&row, "inserted");
        if let Some((did, id)) = crate::events::short_id(uri) {
            crate::events::emit(crate::events::ArticleEvent {
                kind: if inserted { "created" } else { "updated" },
                uri: uri.to_string(),
                did,
                id,
                title: Some(a.title.clone()),
                created_at: Some(a.created_at),
                paid: Some(a.paid),
                source_site: a.source_site.clone(),
                at: chrono::Utc::now(),
            });
        }
    }
    Ok(())
}

pub async fn delete(pool: &PgPool, uri: &str) -> sqlx::Result<()> {
    let gone = sqlx::query("DELETE FROM articles WHERE uri = $1")
        .bind(uri)
        .execute(pool)
        .await?
        .rows_affected();
    if gone > 0 {
        if let Some((did, id)) = crate::events::short_id(uri) {
            crate::events::emit(crate::events::ArticleEvent { kind: "deleted", uri: uri.to_string(), did, id, title: None, created_at: None, paid: None, source_site: None, at: chrono::Utc::now() });
        }
    }
    sqlx::query("DELETE FROM comments WHERE uri = $1")
        .bind(uri)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM likes WHERE uri = $1")
        .bind(uri)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn upsert_comment(
    pool: &PgPool,
    uri: &str,
    did: &str,
    c: &CommentRec,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO comments (uri, did, subject_uri, parent_uri, text, created_at) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (uri) DO UPDATE SET text = EXCLUDED.text, parent_uri = EXCLUDED.parent_uri, indexed_at = now()",
    )
    .bind(uri)
    .bind(did)
    .bind(&c.subject)
    .bind(&c.parent)
    .bind(&c.text)
    .bind(c.created_at)
    .execute(pool)
    .await?;
    Ok(())
}

/// лайк неизменяем; повтор (тот же uri или та же статья от того же did) молча пропускаем
/// аккаунт замечен: first_seen — самое раннее наблюдение (возраст для веса лайка, см. 0006_like_weight.sql)
pub async fn seen(pool: &PgPool, did: &str, at: DateTime<Utc>) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO actors (did, first_seen) VALUES ($1, $2)
         ON CONFLICT (did) DO UPDATE SET first_seen = least(actors.first_seen, EXCLUDED.first_seen)",
    )
    .bind(did)
    .bind(at)
    .execute(pool)
    .await?;
    Ok(())
}

/// вес — на момент индексации (now), а не createdAt записи: его автор может поставить любым
pub async fn upsert_like(pool: &PgPool, uri: &str, did: &str, l: &LikeRec) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO likes (uri, did, subject_uri, created_at, weight)
         VALUES ($1, $2, $3, $4, like_weight($2, $3, now())) ON CONFLICT DO NOTHING",
    )
    .bind(uri)
    .bind(did)
    .bind(&l.subject)
    .bind(l.created_at)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct LikeRow {
    /// статья
    pub subject: String,
    /// запись лайка — по её rkey лайк снимают
    pub uri: String,
}

/// какие из subjects лайкнул did
pub async fn likes_of(pool: &PgPool, did: &str, subjects: &[String]) -> sqlx::Result<Vec<LikeRow>> {
    sqlx::query_as(
        "SELECT subject_uri AS subject, uri FROM likes WHERE did = $1 AND subject_uri = ANY($2)",
    )
    .bind(did)
    .bind(subjects)
    .fetch_all(pool)
    .await
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct CommentRow {
    pub uri: String,
    pub did: String,
    pub handle: Option<String>,
    pub text: String,
    #[serde(rename = "createdAt")]
    pub created_at: DateTime<Utc>,
    /// ответ на комментарий: uri родителя
    pub parent: Option<String>,
}

/// newest — последние сверху (RSS); иначе тред в хронологическом порядке (страница статьи)
pub async fn comments_of(
    pool: &PgPool,
    subject: &str,
    limit: i64,
    newest: bool,
) -> sqlx::Result<Vec<CommentRow>> {
    let order = if newest { "DESC" } else { "ASC" };
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT c.uri, c.did, h.handle, c.text, c.created_at, c.parent_uri AS parent
         FROM comments c LEFT JOIN handles h ON h.did = c.did
         WHERE c.subject_uri = $1 ORDER BY c.created_at {order} LIMIT $2"
    )))
    .bind(subject)
    .bind(limit)
    .fetch_all(pool)
    .await
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AuthorCommentRow {
    pub uri: String,
    pub text: String,
    #[serde(rename = "createdAt")]
    pub created_at: DateTime<Utc>,
    pub parent: Option<String>,
    /// статья, к которой оставлен комментарий
    pub subject: String,
    /// заголовок статьи; None — статьи нет в индексе (удалена или ещё не пришла)
    #[serde(rename = "subjectTitle")]
    pub subject_title: Option<String>,
}

/// комментарии пользователя, новые сверху — для профиля
pub async fn comments_by(
    pool: &PgPool,
    did: &str,
    limit: i64,
) -> sqlx::Result<Vec<AuthorCommentRow>> {
    sqlx::query_as(
        "SELECT c.uri, c.text, c.created_at, c.parent_uri AS parent, c.subject_uri AS subject, a.title AS subject_title
         FROM comments c LEFT JOIN articles a ON a.uri = c.subject_uri
         WHERE c.did = $1 ORDER BY c.created_at DESC LIMIT $2",
    )
    .bind(did)
    .bind(limit)
    .fetch_all(pool)
    .await
}

/// рекомендации к статье — формула в rank::related_sql
/// kind — только видео или только тексты (к видео-записи советуем видео)
pub async fn related(
    pool: &PgPool,
    uri: &str,
    limit: i64,
    kind: Option<&str>,
) -> sqlx::Result<Vec<Row>> {
    sqlx::query_as(sqlx::AssertSqlSafe(crate::rank::related_sql()))
        .bind(uri)
        .bind(limit)
        .bind(kind)
        .fetch_all(pool)
        .await
}

/// uri по короткому id из адреса страницы (/article/<rkey>-<6 последних символов DID>)
pub async fn uri_by_short(
    pool: &PgPool,
    rkey: &str,
    did_tail: &str,
) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar("SELECT uri FROM articles WHERE rkey = $1 AND right(did, 6) = $2 ORDER BY created_at DESC LIMIT 1")
        .bind(rkey)
        .bind(did_tail)
        .fetch_optional(pool)
        .await
}

pub async fn article(pool: &PgPool, uri: &str) -> sqlx::Result<Option<Row>> {
    sqlx::query_as(
        "SELECT a.uri, a.cid, a.did, h.handle, a.created_at, a.indexed_at, a.record,
                coalesce(char_length(a.record->>'text'), 0) AS text_length, a.like_count, a.comment_count,
                NULL::float8 AS score
         FROM articles a LEFT JOIN handles h ON h.did = a.did WHERE a.uri = $1",
    )
    .bind(uri)
    .fetch_optional(pool)
    .await
}

pub async fn did_by_handle(pool: &PgPool, handle: &str) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar("SELECT did FROM handles WHERE lower(handle) = lower($1)")
        .bind(handle)
        .fetch_optional(pool)
        .await
}

/// аккаунт удалён или деактивирован — его статьи из ленты убираем
pub async fn delete_repo(pool: &PgPool, did: &str) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM articles WHERE did = $1")
        .bind(did)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM comments WHERE did = $1")
        .bind(did)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM likes WHERE did = $1")
        .bind(did)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_handle(pool: &PgPool, did: &str, handle: &str) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO handles (did, handle) VALUES ($1, $2) ON CONFLICT (did) DO UPDATE SET handle = EXCLUDED.handle, updated_at = now()")
        .bind(did)
        .bind(handle)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn has_handle(pool: &PgPool, did: &str) -> sqlx::Result<bool> {
    Ok(
        sqlx::query_scalar::<_, i32>("SELECT 1 FROM handles WHERE did = $1")
            .bind(did)
            .fetch_optional(pool)
            .await?
            .is_some(),
    )
}

pub async fn cursor(pool: &PgPool, source: &str) -> sqlx::Result<Option<i64>> {
    sqlx::query_scalar("SELECT seq FROM cursors WHERE source = $1")
        .bind(source)
        .fetch_optional(pool)
        .await
}

pub async fn set_cursor(pool: &PgPool, source: &str, seq: i64) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO cursors (source, seq) VALUES ($1, $2) ON CONFLICT (source) DO UPDATE SET seq = GREATEST(cursors.seq, EXCLUDED.seq)")
        .bind(source)
        .bind(seq)
        .execute(pool)
        .await?;
    Ok(())
}

#[derive(Debug, Default, Clone)]
pub struct Query {
    pub limit: i64,
    /// (created_at, uri) последней записи предыдущей страницы
    pub after: Option<(DateTime<Utc>, String)>,
    /// хотя бы один из тегов (ANY), как фильтр ленты на сайте
    pub tags: Vec<String>,
    pub lang: Option<String>,
    /// Some(true) — только внешние (краулер, репост), Some(false) — только написанные на площадке
    pub external: Option<bool>,
    pub did: Option<String>,
    /** true — запись целиком; false — карточка ленты без текста статьи */
    pub full: bool,
    pub sort: crate::rank::Sort,
    /// Some("video") | Some("text") — только этого типа
    pub kind: Option<&'static str>,
    /// для hot и best: сколько записей пропустить (after у них не используется)
    pub offset: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Row {
    pub uri: String,
    pub cid: String,
    pub did: String,
    pub handle: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: DateTime<Utc>,
    #[serde(rename = "indexedAt")]
    pub indexed_at: DateTime<Utc>,
    pub record: Value,
    /// длина текста в символах — для «N мин чтения» без передачи самого текста
    #[serde(rename = "textLength")]
    pub text_length: i32,
    #[serde(rename = "likeCount")]
    pub like_count: i32,
    #[serde(rename = "commentCount")]
    pub comment_count: i32,
    /// очки ранжирования (hot, best); у new — нет
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
}

pub async fn feed(pool: &PgPool, q: &Query) -> sqlx::Result<Vec<Row>> {
    let (score, window, order) = q.sort.sql();
    // два шага: сначала топ uri по узким колонкам (у hot без фильтров — только индекс articles_rank_idx),
    // затем карточки лишь для этой страницы. В условиях — только включённые фильтры: упоминание любой
    // другой колонки лишило бы Postgres index-only scan.
    let mut b = sqlx::QueryBuilder::<sqlx::Postgres>::new(format!(
        "WITH top AS (SELECT a.uri, a.created_at, a.published_at, a.like_score, a.comment_count, a.completes, {score} AS score
         FROM articles a WHERE true {window}"
    ));
    if let Some((at, uri)) = &q.after {
        b.push(" AND (a.created_at, a.uri) < (")
            .push_bind(*at)
            .push(", ")
            .push_bind(uri.clone())
            .push(")");
    }
    if !q.tags.is_empty() {
        b.push(" AND a.tags && ").push_bind(q.tags.clone());
    }
    if let Some(lang) = &q.lang {
        b.push(" AND (")
            .push_bind(lang.clone())
            .push(" = ANY(a.langs) OR (cardinality(a.langs) = 0 AND ");
        b.push_bind(lang.clone()).push(" = 'ru'))");
    }
    if let Some(external) = q.external {
        b.push(" AND (a.source_site IS NOT NULL) = ")
            .push_bind(external);
    }
    if let Some(did) = &q.did {
        b.push(" AND a.did = ").push_bind(did.clone());
    }
    if let Some(kind) = q.kind {
        b.push(" AND a.kind = ").push_bind(kind);
    }
    b.push(format!(" ORDER BY {order} LIMIT "))
        .push_bind(q.limit)
        .push(" OFFSET ")
        .push_bind(q.offset)
        .push(
            ")
         SELECT a.uri, a.cid, a.did, h.handle, a.created_at, a.indexed_at,
                CASE WHEN ",
        )
        .push_bind(q.full)
        .push(format!(
            " THEN a.record ELSE a.record - 'text' END AS record,
                coalesce(char_length(a.record->>'text'), 0) AS text_length, a.like_count, a.comment_count,
                top.score
         FROM top JOIN articles a ON a.uri = top.uri LEFT JOIN handles h ON h.did = a.did
         ORDER BY {order}"
        ));
    b.build_query_as::<Row>().fetch_all(pool).await
}

pub async fn count(pool: &PgPool, q: &Query) -> sqlx::Result<i64> {
    let (_, window, _) = q.sort.sql();
    let mut b = sqlx::QueryBuilder::<sqlx::Postgres>::new(format!(
        "SELECT count(*) FROM articles a WHERE true {window}"
    ));
    if !q.tags.is_empty() {
        b.push(" AND a.tags && ").push_bind(q.tags.clone());
    }
    if let Some(lang) = &q.lang {
        b.push(" AND (")
            .push_bind(lang.clone())
            .push(" = ANY(a.langs) OR (cardinality(a.langs) = 0 AND ");
        b.push_bind(lang.clone()).push(" = 'ru'))");
    }
    if let Some(external) = q.external {
        b.push(" AND (a.source_site IS NOT NULL) = ")
            .push_bind(external);
    }
    if let Some(did) = &q.did {
        b.push(" AND a.did = ").push_bind(did.clone());
    }
    if let Some(kind) = q.kind {
        b.push(" AND a.kind = ").push_bind(kind);
    }
    b.build_query_scalar().fetch_one(pool).await
}
