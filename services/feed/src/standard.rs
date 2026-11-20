//! Документы standard.site (site.standard.document) из всей сети: Leaflet, pckt и другие площадки.
//!
//! Источник — Jetstream (JSON-поток relay) с фильтром wantedCollections + wantedDids: в индекс попадают
//! только авторы из белого списка standard_allow (его ведут админы). Историю нового автора догружаем
//! с его PDS (DID → PLC / did:web → listRecords). Документ переводится в форму нашей статьи: текст —
//! textContent (простой текст), source — ссылка на оригинал; форматированный content у каждой площадки
//! свой (open union), его не разбираем — полную версию читают на сайте автора.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

use chrono::{DateTime, Utc};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;

use crate::index;
use crate::record::parse_article;

pub const STANDARD_DOC: &str = "site.standard.document";
const PUBLICATION: &str = "site.standard.publication";
/// метка копии, которую weat.media сама делает со своих статей (server/src/standardDoc.ts)
const WEAT_ORIGIN: &str = "weatArticle";
const JETSTREAM_SOURCE: &str = "jetstream:site.standard.document";
/// столько DID помещается в адрес подписки без риска упереться в длину URL
const MAX_DIDS: usize = 500;
const MAX_JSON_BYTES: usize = 16 * 1024 * 1024;

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, _, _] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && b == 168)
                || (a == 192 && b == 0)
                || (a == 192 && b == 0 && ip.octets()[2] == 2)
                || (a == 198 && (b == 18 || b == 19))
                || (a == 198 && b == 51 && ip.octets()[2] == 100)
                || (a == 203 && b == 0 && ip.octets()[2] == 113))
        }
        IpAddr::V6(ip) => {
            if let Some(v4) = ip.to_ipv4_mapped() {
                return public_ip(IpAddr::V4(v4));
            }
            ip.segments()[0] & 0xe000 == 0x2000
        }
    }
}

#[derive(Clone)]
pub struct Resolver {
    pub plc_url: String,
    /// at://…/site.standard.publication/… → url издания
    publications: std::sync::Arc<Mutex<HashMap<String, Option<String>>>>,
}

pub struct Identity {
    pub pds: String,
    pub handle: Option<String>,
}

impl Resolver {
    pub fn new(plc_url: String) -> Self {
        Self {
            plc_url: plc_url.trim_end_matches('/').to_string(),
            publications: Default::default(),
        }
    }

    async fn json(&self, url: &str) -> Option<Value> {
        self.json_query(url, &[]).await
    }

    /// Внешний PDS недоверенный: только публичный HTTPS, DNS закреплён за проверенными адресами,
    /// редиректы запрещены (иначе публичный адрес мог бы перенаправить во внутреннюю сеть).
    async fn json_query(&self, url: &str, query: &[(&str, &str)]) -> Option<Value> {
        let url = reqwest::Url::parse(url).ok()?;
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port().is_some_and(|p| p != 443)
        {
            return None;
        }
        let host = url.host_str()?;
        let port = url.port().unwrap_or(443);
        let addrs: Vec<SocketAddr> = if let Ok(ip) = host.parse::<IpAddr>() {
            vec![SocketAddr::new(ip, port)]
        } else {
            tokio::net::lookup_host((host, port)).await.ok()?.collect()
        };
        if addrs.is_empty() || addrs.iter().any(|a| !public_ip(a.ip())) {
            return None;
        }
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(15))
            .resolve_to_addrs(host, &addrs)
            .build()
            .ok()?;
        let res = client.get(url).query(query).send().await.ok()?;
        if !res.status().is_success()
            || res
                .content_length()
                .is_some_and(|n| n > MAX_JSON_BYTES as u64)
        {
            return None;
        }
        let mut stream = res.bytes_stream();
        let mut body = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.ok()?;
            if body.len() + chunk.len() > MAX_JSON_BYTES {
                return None;
            }
            body.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&body).ok()
    }

    /// DID-документ: адрес PDS и handle (alsoKnownAs at://<handle>)
    pub async fn identity(&self, did: &str) -> Option<Identity> {
        let doc = if did.starts_with("did:plc:") {
            self.json(&format!("{}/{did}", self.plc_url)).await?
        } else {
            let host = did.strip_prefix("did:web:")?;
            // did:web только с доменом: пути (did:web:host:path) и порты не поддерживаем
            if host.contains(':') || host.contains('/') {
                return None;
            }
            self.json(&format!("https://{host}/.well-known/did.json"))
                .await?
        };
        let pds = doc
            .get("service")?
            .as_array()?
            .iter()
            .find(|s| {
                s.get("id")
                    .and_then(Value::as_str)
                    .is_some_and(|id| id.ends_with("#atproto_pds"))
            })?
            .get("serviceEndpoint")?
            .as_str()?
            .trim_end_matches('/')
            .to_string();
        if !pds.starts_with("https://") {
            return None;
        }
        let handle = doc
            .get("alsoKnownAs")
            .and_then(Value::as_array)
            .and_then(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .find_map(|s| s.strip_prefix("at://"))
            })
            .map(str::to_string);
        Some(Identity { pds, handle })
    }

    /// канонический адрес документа: url издания (или site, если это https) + path
    pub async fn canonical(&self, rec: &Value) -> Option<String> {
        let site = rec.get("site")?.as_str()?.trim_end_matches('/');
        let base = if site.starts_with("https://") {
            Some(site.to_string())
        } else if let Some(rest) = site.strip_prefix("at://") {
            self.publication_url(site, rest).await
        } else {
            None
        }?;
        let path = rec.get("path").and_then(Value::as_str).unwrap_or("");
        let path = if path.is_empty() || path.starts_with('/') {
            path.to_string()
        } else {
            format!("/{path}")
        };
        Some(format!("{}{path}", base.trim_end_matches('/')))
    }

    async fn publication_url(&self, uri: &str, rest: &str) -> Option<String> {
        if let Some(hit) = self.publications.lock().await.get(uri) {
            return hit.clone();
        }
        let mut parts = rest.splitn(3, '/');
        let (did, coll, rkey) = (parts.next()?, parts.next()?, parts.next()?);
        let url = if coll == PUBLICATION {
            match self.identity(did).await {
                Some(id) => self
                    .json(&format!(
                        "{}/xrpc/com.atproto.repo.getRecord?repo={did}&collection={coll}&rkey={rkey}",
                        id.pds
                    ))
                    .await
                    .and_then(|r| r.get("value")?.get("url")?.as_str().map(str::to_string))
                    .filter(|u| u.starts_with("https://")),
                None => None,
            }
        } else {
            None
        };
        let mut cache = self.publications.lock().await;
        if cache.len() > 5000 {
            cache.clear();
        }
        cache.insert(uri.to_string(), url.clone());
        url
    }
}

/// site.standard.document → запись в форме media.weat.article; None — не документ или копия weat.media
pub fn to_article_record(
    rec: &Value,
    canonical: Option<&str>,
    now: DateTime<Utc>,
) -> Option<Value> {
    if rec.get(WEAT_ORIGIN).is_some() {
        return None;
    }
    let title = rec.get("title")?.as_str()?.trim();
    if title.is_empty() {
        return None;
    }
    let description = rec
        .get("description")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(30_000).collect::<String>());
    let text = rec
        .get("textContent")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or(description.as_deref())?;
    // дата из будущего не закрепляет запись наверху; без даты — момент индексации
    let published = rec
        .get("publishedAt")
        .and_then(Value::as_str)
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc))
        .filter(|d| *d <= now)
        .unwrap_or(now);
    let site = canonical
        .and_then(|u| u.strip_prefix("https://"))
        .and_then(|u| u.split('/').next())
        .map(str::to_string);
    let tags: Vec<String> = rec
        .get("tags")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(|t| t.trim_start_matches('#'))
                .filter(|t| !t.is_empty())
                .take(20)
                .map(|t| t.chars().take(1280).collect())
                .collect()
        })
        .unwrap_or_default();
    let mut source = json!({ "kind": "standard.site", "publishedAt": published.to_rfc3339() });
    if let Some(url) = canonical {
        source["url"] = json!(url);
    }
    // source.site обязателен: по нему лента отличает внешние записи от родных (source_site IS NOT NULL)
    source["site"] = json!(site.unwrap_or_else(|| "standard.site".to_string()));
    let mut out = json!({
        "$type": "media.weat.article",
        "title": title.chars().take(5000).collect::<String>(),
        "text": text.chars().take(100_000).collect::<String>(),
        "tags": tags,
        "createdAt": published.to_rfc3339(),
        "source": source,
    });
    if let Some(d) = description {
        out["excerpt"] = json!(d);
    }
    Some(out)
}

async fn index_doc(
    pool: &PgPool,
    res: &Resolver,
    did: &str,
    rkey: &str,
    cid: &str,
    rec: &Value,
) -> sqlx::Result<()> {
    let uri = format!("at://{did}/{STANDARD_DOC}/{rkey}");
    let canonical = res.canonical(rec).await;
    let now = Utc::now();
    match to_article_record(rec, canonical.as_deref(), now)
        .and_then(|r| parse_article(&r, now).map(|a| (r, a)))
    {
        Some((record, article)) => {
            index::seen(pool, did, now).await?;
            index::upsert(pool, &uri, did, rkey, cid, &article, &record).await
        }
        None => index::delete(pool, &uri).await,
    }
}

#[derive(Deserialize)]
struct Records {
    records: Vec<Rec>,
    cursor: Option<String>,
}
#[derive(Deserialize)]
struct Rec {
    uri: String,
    cid: String,
    value: Value,
}

/// история автора с его PDS; заодно handle
async fn backfill_did(pool: &PgPool, res: &Resolver, did: &str) -> sqlx::Result<usize> {
    let Some(id) = res.identity(did).await else {
        tracing::warn!(%did, "standard: DID не разрешился");
        return Ok(0);
    };
    if let Some(h) = &id.handle {
        index::set_handle(pool, did, h).await?;
    }
    let mut n = 0;
    let mut cursor: Option<String> = None;
    for _ in 0..50 {
        let url = format!("{}/xrpc/com.atproto.repo.listRecords", id.pds);
        let mut query = vec![
            ("repo", did),
            ("collection", STANDARD_DOC),
            ("limit", "100"),
        ];
        if let Some(c) = &cursor {
            query.push(("cursor", c.as_str()));
        }
        let Some(page) = res
            .json_query(&url, &query)
            .await
            .and_then(|v| serde_json::from_value::<Records>(v).ok())
        else {
            break;
        };
        for r in &page.records {
            let rkey = r.uri.rsplit('/').next().unwrap_or_default();
            index_doc(pool, res, did, rkey, &r.cid, &r.value).await?;
            n += 1;
        }
        match page.cursor {
            Some(c) if !page.records.is_empty() => cursor = Some(c),
            _ => break,
        }
    }
    Ok(n)
}

/// белый список; авторы без догрузки — догружаем
async fn allowlist(pool: &PgPool, res: &Resolver) -> sqlx::Result<Vec<String>> {
    let pending: Vec<String> =
        sqlx::query_scalar("SELECT did FROM standard_allow WHERE backfilled_at IS NULL")
            .fetch_all(pool)
            .await?;
    for did in pending {
        let n = backfill_did(pool, res, &did).await?;
        tracing::info!(%did, docs = n, "standard backfill");
        sqlx::query("UPDATE standard_allow SET backfilled_at = now() WHERE did = $1")
            .bind(&did)
            .execute(pool)
            .await?;
    }
    sqlx::query_scalar("SELECT did FROM standard_allow ORDER BY added_at LIMIT $1")
        .bind(MAX_DIDS as i64)
        .fetch_all(pool)
        .await
}

/// Подписка на Jetstream; при изменении белого списка — переподключение с новым wantedDids
pub async fn run(pool: PgPool, res: Resolver, jetstream: String) {
    let mut backoff = Duration::from_secs(1);
    loop {
        let dids = match allowlist(&pool, &res).await {
            Ok(d) => d,
            Err(err) => {
                tracing::error!(%err, "standard allowlist");
                tokio::time::sleep(Duration::from_secs(60)).await;
                continue;
            }
        };
        if dids.is_empty() {
            tokio::time::sleep(Duration::from_secs(60)).await;
            continue;
        }
        let mut url = format!(
            "{}/subscribe?wantedCollections={STANDARD_DOC}",
            jetstream.trim_end_matches('/')
        );
        for d in &dids {
            url.push_str("&wantedDids=");
            url.push_str(d);
        }
        // курсор — микросекунды; Jetstream хранит около суток, дальше догрузка восполняет пропуск
        if let Ok(Some(c)) = index::cursor(&pool, JETSTREAM_SOURCE).await {
            url.push_str(&format!("&cursor={c}"));
        }
        match tokio_tungstenite::connect_async(&url).await {
            Ok((mut ws, _)) => {
                tracing::info!(dids = dids.len(), "jetstream connected");
                backoff = Duration::from_secs(1);
                let mut last: Option<i64> = None;
                let mut flush = tokio::time::interval(Duration::from_secs(1));
                let mut recheck = tokio::time::interval(Duration::from_secs(60));
                recheck.tick().await;
                let mut changed = false;
                loop {
                    tokio::select! {
                        msg = ws.next() => match msg {
                            Some(Ok(Message::Text(t))) => {
                                let Ok(ev) = serde_json::from_str::<Value>(&t) else { continue };
                                if let Some(us) = ev.get("time_us").and_then(Value::as_i64) {
                                    last = Some(last.map_or(us, |l| l.max(us)));
                                }
                                if let Err(err) = apply(&pool, &res, &dids, &ev).await {
                                    tracing::error!(%err, "standard index write");
                                }
                            }
                            Some(Ok(Message::Close(_))) | None => break,
                            Some(Ok(_)) => {}
                            Some(Err(err)) => { tracing::warn!(%err, "jetstream read"); break }
                        },
                        _ = flush.tick() => if let Some(s) = last.take()
                            && let Err(err) = index::set_cursor(&pool, JETSTREAM_SOURCE, s).await { tracing::error!(%err, "jetstream cursor") },
                        _ = recheck.tick() => {
                            let now: Vec<String> = sqlx::query_scalar("SELECT did FROM standard_allow ORDER BY added_at LIMIT $1")
                                .bind(MAX_DIDS as i64).fetch_all(&pool).await.unwrap_or_else(|_| dids.clone());
                            let pending: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM standard_allow WHERE backfilled_at IS NULL)")
                                .fetch_one(&pool).await.unwrap_or(false);
                            if now != dids || pending { changed = true; break }
                        }
                    }
                }
                if let Some(s) = last {
                    let _ = index::set_cursor(&pool, JETSTREAM_SOURCE, s).await;
                }
                // список изменился — сразу новая подписка; обрыв — с паузой, как при ошибке соединения
                if changed {
                    continue;
                }
            }
            Err(err) => tracing::warn!(%err, "jetstream connect"),
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_secs(60));
    }
}

async fn apply(pool: &PgPool, res: &Resolver, dids: &[String], ev: &Value) -> sqlx::Result<()> {
    let Some(did) = ev.get("did").and_then(Value::as_str) else {
        return Ok(());
    };
    // Jetstream уже отфильтровал, но автор мог выйти из списка до переподключения
    if !dids.iter().any(|d| d == did) {
        return Ok(());
    }
    match ev.get("kind").and_then(Value::as_str) {
        Some("commit") => {
            let Some(c) = ev.get("commit") else {
                return Ok(());
            };
            if c.get("collection").and_then(Value::as_str) != Some(STANDARD_DOC) {
                return Ok(());
            }
            let Some(rkey) = c.get("rkey").and_then(Value::as_str) else {
                return Ok(());
            };
            match c.get("operation").and_then(Value::as_str) {
                Some("create") | Some("update") => {
                    let (Some(rec), Some(cid)) =
                        (c.get("record"), c.get("cid").and_then(Value::as_str))
                    else {
                        return Ok(());
                    };
                    index_doc(pool, res, did, rkey, cid, rec).await
                }
                Some("delete") => {
                    index::delete(pool, &format!("at://{did}/{STANDARD_DOC}/{rkey}")).await
                }
                _ => Ok(()),
            }
        }
        Some("identity") => match ev
            .get("identity")
            .and_then(|i| i.get("handle"))
            .and_then(Value::as_str)
        {
            Some(h) => index::set_handle(pool, did, h).await,
            None => Ok(()),
        },
        Some("account")
            if ev
                .get("account")
                .and_then(|a| a.get("active"))
                .and_then(Value::as_bool)
                == Some(false) =>
        {
            // аккаунт удалён или отключён — документы из ленты убираем; вернётся — догрузим заново
            sqlx::query("DELETE FROM articles WHERE did = $1 AND uri LIKE $2")
                .bind(did)
                .bind(format!("at://{did}/{STANDARD_DOC}/%"))
                .execute(pool)
                .await?;
            sqlx::query("UPDATE standard_allow SET backfilled_at = NULL WHERE did = $1")
                .bind(did)
                .execute(pool)
                .await?;
            Ok(())
        }
        _ => Ok(()),
    }
}

/// белый список для админки (через AppView, по FEED_ADMIN_TOKEN)
#[derive(serde::Serialize, sqlx::FromRow)]
pub struct Allowed {
    pub did: String,
    pub note: Option<String>,
    pub added_at: DateTime<Utc>,
    pub backfilled_at: Option<DateTime<Utc>>,
    pub handle: Option<String>,
    pub docs: i64,
}

pub async fn list_allowed(pool: &PgPool) -> sqlx::Result<Vec<Allowed>> {
    sqlx::query_as(
        "SELECT s.did, s.note, s.added_at, s.backfilled_at, h.handle,
                (SELECT count(*) FROM articles a WHERE a.did = s.did AND a.uri LIKE 'at://' || s.did || '/site.standard.document/%') AS docs
         FROM standard_allow s LEFT JOIN handles h ON h.did = s.did ORDER BY s.added_at DESC",
    )
    .fetch_all(pool)
    .await
}

pub async fn allow(pool: &PgPool, did: &str, note: Option<&str>) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO standard_allow (did, note) VALUES ($1, $2) ON CONFLICT (did) DO UPDATE SET note = EXCLUDED.note")
        .bind(did)
        .bind(note)
        .execute(pool)
        .await?;
    Ok(())
}

/// исключение из списка убирает и уже проиндексированные документы автора
pub async fn disallow(pool: &PgPool, did: &str) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM standard_allow WHERE did = $1")
        .bind(did)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM articles WHERE did = $1 AND uri LIKE $2")
        .bind(did)
        .bind(format!("at://{did}/{STANDARD_DOC}/%"))
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-11-20T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn converts_document_with_canonical_link() {
        let rec = json!({
            "$type": "site.standard.document", "site": "at://did:plc:x/site.standard.publication/p", "path": "/hello",
            "title": " Hello ", "description": "Short", "textContent": "Para one\n\nPara two",
            "tags": ["#rust", "web"], "publishedAt": "2026-11-01T10:00:00Z",
            "content": { "$type": "blog.pckt.content", "items": [] }
        });
        let out = to_article_record(&rec, Some("https://blog.example.com/hello"), now()).unwrap();
        assert_eq!(out["title"], "Hello");
        assert_eq!(out["text"], "Para one\n\nPara two");
        assert_eq!(out["excerpt"], "Short");
        assert_eq!(out["tags"], json!(["rust", "web"]));
        assert_eq!(out["source"]["url"], "https://blog.example.com/hello");
        assert_eq!(out["source"]["site"], "blog.example.com");
        assert_eq!(out["source"]["kind"], "standard.site");
        let a = parse_article(&out, now()).unwrap();
        assert_eq!(a.source_site.as_deref(), Some("blog.example.com"));
        assert!(!a.paid);
    }

    #[test]
    fn skips_weat_copies_empty_and_clamps_future_date() {
        let base = json!({ "site": "https://a.b", "title": "T", "textContent": "x", "publishedAt": "2099-01-01T00:00:00Z" });
        let mut copy = base.clone();
        copy["weatArticle"] = json!("at://did:plc:me/media.weat.article/k");
        assert!(to_article_record(&copy, None, now()).is_none());
        assert!(
            to_article_record(&json!({ "site": "https://a.b", "title": "T" }), None, now())
                .is_none()
        );
        let out = to_article_record(&base, None, now()).unwrap();
        assert_eq!(out["createdAt"], now().to_rfc3339());
        assert_eq!(out["source"]["site"], "standard.site");
    }

    #[test]
    fn rejects_private_and_special_ip_addresses() {
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "0.0.0.0",
            "::1",
            "fc00::1",
            "fe80::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(!public_ip(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"] {
            assert!(public_ip(ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn fuzz_document_shapes_and_bound_output() {
        let mut seed = 0x9e3779b97f4a7c15u64;
        for i in 0..10_000 {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            let text = if i % 1000 == 0 {
                "💥".repeat(100_001)
            } else {
                format!("text {seed}\0\u{202e}")
            };
            let rec = json!({
                "title": if i % 3 == 0 { json!(["not", "a", "string"]) } else { json!(format!(" title {i} ")) },
                "textContent": if i % 5 == 0 { json!(null) } else { json!(text) },
                "description": if i % 7 == 0 { json!(42) } else { json!("description") },
                "publishedAt": format!("{seed}-not-a-date"),
                "tags": ["#ok", "", 1, null, "💥"],
            });
            if let Some(out) = to_article_record(&rec, Some("https://blog.example/x"), now()) {
                assert!(out["title"].as_str().unwrap().chars().count() <= 5000);
                assert!(out["text"].as_str().unwrap().chars().count() <= 100_000);
                assert!(parse_article(&out, now()).is_some());
            }
        }
    }
}
