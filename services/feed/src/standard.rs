//! Документы standard.site (site.standard.document) из всей сети: Leaflet, pckt и другие площадки.
//!
//! Источник — Jetstream (JSON-поток relay) с фильтром wantedCollections + wantedDids: в индекс попадают
//! только авторы из белого списка standard_allow (его ведут админы). Историю нового автора догружаем
//! с его PDS (DID → PLC / did:web → listRecords). Документ переводится в форму нашей статьи: текст —
//! textContent (простой текст), source — ссылка на оригинал; форматированный content у каждой площадки
//! свой (open union), его не разбираем — полную версию читают на сайте автора.

use std::collections::{HashMap, HashSet};
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
    // textContent — по стандарту; у Leaflet он часто пуст, текст — в блоках pub.leaflet.content
    let leaflet = leaflet_text(rec.get("content"));
    let text = rec
        .get("textContent")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or(leaflet.as_deref())
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
    // площадка (content.$type): по ней админка считает документы и убирает их при выключении
    if let Some(t) = content_type(rec) {
        out["platform"] = json!(t.chars().take(200).collect::<String>());
    }
    let langs: Vec<String> = rec
        .get("langs")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).filter(|l| (2..=10).contains(&l.len())).take(3).map(str::to_string).collect())
        .unwrap_or_default();
    if !langs.is_empty() {
        out["langs"] = json!(langs);
    }
    Some(out)
}

/// content.$type документа: по нему узнаём площадку (pub.leaflet.content, blog.pckt.content…)
pub fn content_type(rec: &Value) -> Option<&str> {
    rec.get("content")?.get("$type")?.as_str()
}

/// Текст Leaflet: страницы → блоки text, header, списки (с вложенностью) → абзацы markdown
pub fn leaflet_text(content: Option<&Value>) -> Option<String> {
    let content = content?;
    if content.get("$type")?.as_str()? != "pub.leaflet.content" {
        return None;
    }
    fn list(items: &Value, ordered: bool, depth: usize, out: &mut Vec<String>) {
        for (i, item) in items.as_array().into_iter().flatten().enumerate() {
            if let Some(t) = item.get("content").and_then(|c| c.get("plaintext")).and_then(Value::as_str).map(str::trim).filter(|t| !t.is_empty()) {
                let marker = if ordered { format!("{}.", i + 1) } else { "-".to_string() };
                out.push(format!("{}{marker} {t}", "  ".repeat(depth)));
            }
            if let Some(children) = item.get("children") {
                list(children, ordered, depth + 1, out);
            }
        }
    }
    let mut paras: Vec<String> = Vec::new();
    for page in content.get("pages")?.as_array()? {
        for b in page.get("blocks").and_then(Value::as_array).into_iter().flatten() {
            let Some(block) = b.get("block") else { continue };
            let plain = block.get("plaintext").and_then(Value::as_str).map(str::trim).filter(|t| !t.is_empty());
            match block.get("$type").and_then(Value::as_str) {
                Some("pub.leaflet.blocks.header") => {
                    if let Some(t) = plain {
                        let level = block.get("level").and_then(Value::as_u64).unwrap_or(2).clamp(2, 3) as usize;
                        paras.push(format!("{} {t}", "#".repeat(level)));
                    }
                }
                Some("pub.leaflet.blocks.unorderedList") | Some("pub.leaflet.blocks.orderedList") => {
                    let ordered = block.get("$type").and_then(Value::as_str) == Some("pub.leaflet.blocks.orderedList");
                    let mut items = Vec::new();
                    if let Some(children) = block.get("children") {
                        list(children, ordered, 0, &mut items);
                    }
                    if !items.is_empty() {
                        paras.push(items.join("\n"));
                    }
                }
                Some("pub.leaflet.blocks.blockquote") => {
                    if let Some(t) = plain {
                        paras.push(format!("> {t}"));
                    }
                }
                _ => {
                    if let Some(t) = plain {
                        paras.push(t.to_string());
                    }
                }
            }
        }
    }
    let text = paras.join("\n\n");
    (!text.trim().is_empty()).then_some(text)
}

/// документ с площадки (без белого списка) короче — заглушка или «скоро тут будет»; в ленту не берём
const PLATFORM_MIN_TEXT: usize = 280;

async fn index_doc(
    pool: &PgPool,
    res: &Resolver,
    did: &str,
    rkey: &str,
    cid: &str,
    rec: &Value,
    trusted: bool,
) -> sqlx::Result<()> {
    let uri = format!("at://{did}/{STANDARD_DOC}/{rkey}");
    let now = Utc::now();
    let Some(record) = to_article_record(rec, None, now)
        .filter(|r| trusted || r.get("text").and_then(Value::as_str).is_some_and(|t| t.chars().count() >= PLATFORM_MIN_TEXT))
    else {
        return index::delete(pool, &uri).await;
    };
    // канонический адрес — только для того, что прошло фильтр: это сетевые запросы к чужим PDS
    let canonical = res.canonical(rec).await;
    let record = to_article_record(rec, canonical.as_deref(), now).unwrap_or(record);
    let Some(article) = parse_article(&record, now) else {
        return index::delete(pool, &uri).await;
    };
    // автор с площадки нам ещё не знаком — handle из DID-документа (лента показывает @handle)
    if !index::has_handle(pool, did).await?
        && let Some(h) = res.identity(did).await.and_then(|i| i.handle)
    {
        index::set_handle(pool, did, &h).await?;
    }
    index::seen(pool, did, now).await?;
    index::upsert(pool, &uri, did, rkey, cid, &article, &record).await
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
            index_doc(pool, res, did, rkey, &r.cid, &r.value, true).await?;
            n += 1;
        }
        match page.cursor {
            Some(c) if !page.records.is_empty() => cursor = Some(c),
            _ => break,
        }
    }
    Ok(n)
}

/// Кого берём в ленту: автор из белого списка — всегда; иначе — документ включённой площадки,
/// если автор не заблокирован
#[derive(Default, Clone, PartialEq)]
pub struct Policy {
    pub allow: HashSet<String>,
    pub platforms: HashSet<String>,
    pub block: HashSet<String>,
}

impl Policy {
    pub fn accepts(&self, did: &str, content_type: Option<&str>) -> Option<bool> {
        if self.block.contains(did) {
            return None;
        }
        if self.allow.contains(did) {
            return Some(true);
        }
        content_type.filter(|t| self.platforms.contains(*t)).map(|_| false)
    }
    /// площадки включены — читаем все документы сети и фильтруем сами (wantedDids не подходит)
    fn whole_network(&self) -> bool {
        !self.platforms.is_empty()
    }
}

/// политика из базы; новых авторов белого списка догружаем, новую площадку — перематываем поток на сутки
async fn load_policy(pool: &PgPool, res: &Resolver) -> sqlx::Result<Policy> {
    let pending: Vec<String> = sqlx::query_scalar("SELECT did FROM standard_allow WHERE backfilled_at IS NULL")
        .fetch_all(pool)
        .await?;
    for did in pending {
        let n = backfill_did(pool, res, &did).await?;
        tracing::info!(%did, docs = n, "standard backfill");
        sqlx::query("UPDATE standard_allow SET backfilled_at = now() WHERE did = $1").bind(&did).execute(pool).await?;
    }
    let fresh: Vec<String> = sqlx::query_scalar("SELECT content_type FROM standard_platforms WHERE enabled AND backfilled_at IS NULL")
        .fetch_all(pool)
        .await?;
    if !fresh.is_empty() {
        // Jetstream хранит около суток: свежие документы площадки придут из потока, история старше — нет
        let day_ago = (Utc::now() - chrono::Duration::hours(24)).timestamp_micros();
        sqlx::query("INSERT INTO cursors (source, seq) VALUES ($1, $2) ON CONFLICT (source) DO UPDATE SET seq = LEAST(cursors.seq, EXCLUDED.seq)")
            .bind(JETSTREAM_SOURCE)
            .bind(day_ago)
            .execute(pool)
            .await?;
        sqlx::query("UPDATE standard_platforms SET backfilled_at = now() WHERE content_type = ANY($1)").bind(&fresh).execute(pool).await?;
        tracing::info!(platforms = ?fresh, "standard: поток перемотан на сутки для новых площадок");
    }
    Ok(Policy {
        allow: sqlx::query_scalar("SELECT did FROM standard_allow ORDER BY added_at LIMIT $1")
            .bind(MAX_DIDS as i64)
            .fetch_all(pool)
            .await?
            .into_iter()
            .collect(),
        platforms: sqlx::query_scalar("SELECT content_type FROM standard_platforms WHERE enabled").fetch_all(pool).await?.into_iter().collect(),
        block: sqlx::query_scalar("SELECT did FROM standard_block").fetch_all(pool).await?.into_iter().collect(),
    })
}

/// авторы, чьи документы уже в индексе: им — identity и account из потока (остальной сети — нет)
async fn known_authors(pool: &PgPool) -> sqlx::Result<HashSet<String>> {
    Ok(sqlx::query_scalar("SELECT DISTINCT did FROM articles WHERE uri LIKE 'at://%/site.standard.document/%'")
        .fetch_all(pool)
        .await?
        .into_iter()
        .collect())
}

/// Подписка на Jetstream; при изменении политики — переподключение (другой набор wantedDids или вся сеть)
pub async fn run(pool: PgPool, res: Resolver, jetstream: String) {
    let mut backoff = Duration::from_secs(1);
    loop {
        let (policy, mut known) = match (load_policy(&pool, &res).await, known_authors(&pool).await) {
            (Ok(p), Ok(k)) => (p, k),
            (Err(err), _) | (_, Err(err)) => {
                tracing::error!(%err, "standard policy");
                tokio::time::sleep(Duration::from_secs(60)).await;
                continue;
            }
        };
        if policy.allow.is_empty() && !policy.whole_network() {
            tokio::time::sleep(Duration::from_secs(60)).await;
            continue;
        }
        let mut url = format!("{}/subscribe?wantedCollections={STANDARD_DOC}", jetstream.trim_end_matches('/'));
        if !policy.whole_network() {
            for d in &policy.allow {
                url.push_str("&wantedDids=");
                url.push_str(d);
            }
        }
        // курсор — микросекунды; Jetstream хранит около суток, дальше догрузка восполняет пропуск
        if let Ok(Some(c)) = index::cursor(&pool, JETSTREAM_SOURCE).await {
            url.push_str(&format!("&cursor={c}"));
        }
        match tokio_tungstenite::connect_async(&url).await {
            Ok((mut ws, _)) => {
                tracing::info!(allow = policy.allow.len(), platforms = policy.platforms.len(), "jetstream connected");
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
                                if let Err(err) = apply(&pool, &res, &policy, &mut known, &ev).await {
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
                            let pending: bool = sqlx::query_scalar(
                                "SELECT EXISTS (SELECT 1 FROM standard_allow WHERE backfilled_at IS NULL)
                                     OR EXISTS (SELECT 1 FROM standard_platforms WHERE enabled AND backfilled_at IS NULL)")
                                .fetch_one(&pool).await.unwrap_or(false);
                            let now = load_policy_cheap(&pool).await.unwrap_or_else(|_| policy.clone());
                            if now != policy || pending { changed = true; break }
                        }
                    }
                }
                if let Some(s) = last {
                    let _ = index::set_cursor(&pool, JETSTREAM_SOURCE, s).await;
                }
                // политика изменилась — сразу новая подписка; обрыв — с паузой, как при ошибке соединения
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

/// политика без догрузок и перемотки — для проверки «изменилось ли»
async fn load_policy_cheap(pool: &PgPool) -> sqlx::Result<Policy> {
    Ok(Policy {
        allow: sqlx::query_scalar("SELECT did FROM standard_allow ORDER BY added_at LIMIT $1").bind(MAX_DIDS as i64).fetch_all(pool).await?.into_iter().collect(),
        platforms: sqlx::query_scalar("SELECT content_type FROM standard_platforms WHERE enabled").fetch_all(pool).await?.into_iter().collect(),
        block: sqlx::query_scalar("SELECT did FROM standard_block").fetch_all(pool).await?.into_iter().collect(),
    })
}

async fn apply(pool: &PgPool, res: &Resolver, policy: &Policy, known: &mut HashSet<String>, ev: &Value) -> sqlx::Result<()> {
    let Some(did) = ev.get("did").and_then(Value::as_str) else {
        return Ok(());
    };
    match ev.get("kind").and_then(Value::as_str) {
        Some("commit") => {
            let Some(c) = ev.get("commit") else { return Ok(()) };
            if c.get("collection").and_then(Value::as_str) != Some(STANDARD_DOC) {
                return Ok(());
            }
            let Some(rkey) = c.get("rkey").and_then(Value::as_str) else { return Ok(()) };
            match c.get("operation").and_then(Value::as_str) {
                Some("create") | Some("update") => {
                    let (Some(rec), Some(cid)) = (c.get("record"), c.get("cid").and_then(Value::as_str)) else { return Ok(()) };
                    match policy.accepts(did, content_type(rec)) {
                        Some(trusted) => {
                            index_doc(pool, res, did, rkey, cid, rec, trusted).await?;
                            known.insert(did.to_string());
                            Ok(())
                        }
                        // правка увела документ с площадки или автора заблокировали — убрать, если был
                        None if known.contains(did) => index::delete(pool, &format!("at://{did}/{STANDARD_DOC}/{rkey}")).await,
                        None => Ok(()),
                    }
                }
                Some("delete") if known.contains(did) => index::delete(pool, &format!("at://{did}/{STANDARD_DOC}/{rkey}")).await,
                _ => Ok(()),
            }
        }
        Some("identity") if known.contains(did) => match ev.get("identity").and_then(|i| i.get("handle")).and_then(Value::as_str) {
            Some(h) => index::set_handle(pool, did, h).await,
            None => Ok(()),
        },
        Some("account") if known.contains(did) && ev.get("account").and_then(|a| a.get("active")).and_then(Value::as_bool) == Some(false) => {
            // аккаунт удалён или отключён — документы из ленты убираем; вернётся — догрузим заново
            sqlx::query("DELETE FROM articles WHERE did = $1 AND uri LIKE $2")
                .bind(did)
                .bind(format!("at://{did}/{STANDARD_DOC}/%"))
                .execute(pool)
                .await?;
            sqlx::query("UPDATE standard_allow SET backfilled_at = NULL WHERE did = $1").bind(did).execute(pool).await?;
            known.remove(did);
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

/// площадки для админки: включена ли, сколько документов в индексе
#[derive(serde::Serialize, sqlx::FromRow)]
pub struct Platform {
    pub content_type: String,
    pub name: String,
    pub url: Option<String>,
    pub enabled: bool,
    pub docs: i64,
}

pub async fn list_platforms(pool: &PgPool) -> sqlx::Result<Vec<Platform>> {
    sqlx::query_as(
        "SELECT p.content_type, p.name, p.url, p.enabled,
                (SELECT count(*) FROM articles a WHERE a.uri LIKE 'at://%/site.standard.document/%' AND a.record->>'platform' = p.content_type) AS docs
         FROM standard_platforms p ORDER BY p.name",
    )
    .fetch_all(pool)
    .await
}

/// выключение убирает из ленты документы площадки (кроме авторов из белого списка); включение — перемотка на сутки
pub async fn set_platform(pool: &PgPool, content_type: &str, enabled: bool) -> sqlx::Result<bool> {
    let found = sqlx::query("UPDATE standard_platforms SET enabled = $2, backfilled_at = CASE WHEN $2 THEN NULL ELSE backfilled_at END WHERE content_type = $1")
        .bind(content_type)
        .bind(enabled)
        .execute(pool)
        .await?
        .rows_affected()
        > 0;
    if found && !enabled {
        sqlx::query(
            "DELETE FROM articles WHERE uri LIKE 'at://%/site.standard.document/%' AND record->>'platform' = $1
               AND did NOT IN (SELECT did FROM standard_allow)",
        )
        .bind(content_type)
        .execute(pool)
        .await?;
    }
    Ok(found)
}

#[derive(serde::Serialize, sqlx::FromRow)]
pub struct Blocked {
    pub did: String,
    pub note: Option<String>,
    pub added_at: DateTime<Utc>,
    pub handle: Option<String>,
}

pub async fn list_blocked(pool: &PgPool) -> sqlx::Result<Vec<Blocked>> {
    sqlx::query_as("SELECT b.did, b.note, b.added_at, h.handle FROM standard_block b LEFT JOIN handles h ON h.did = b.did ORDER BY b.added_at DESC")
        .fetch_all(pool)
        .await
}

/// блокировка: автор пропадает из ленты и белого списка
pub async fn block(pool: &PgPool, did: &str, note: Option<&str>) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO standard_block (did, note) VALUES ($1, $2) ON CONFLICT (did) DO UPDATE SET note = EXCLUDED.note")
        .bind(did)
        .bind(note)
        .execute(pool)
        .await?;
    disallow(pool, did).await
}

pub async fn unblock(pool: &PgPool, did: &str) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM standard_block WHERE did = $1").bind(did).execute(pool).await?;
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

    #[test]
    fn leaflet_blocks_become_markdown() {
        let content = json!({ "$type": "pub.leaflet.content", "pages": [{ "$type": "pub.leaflet.pages.linearDocument", "blocks": [
            { "block": { "$type": "pub.leaflet.blocks.header", "level": 1, "plaintext": "Title" } },
            { "block": { "$type": "pub.leaflet.blocks.text", "plaintext": "Para" } },
            { "block": { "$type": "pub.leaflet.blocks.unorderedList", "children": [
                { "content": { "plaintext": "one" }, "children": [{ "content": { "plaintext": "nested" } }] },
                { "content": { "plaintext": "two" } } ] } },
            { "block": { "$type": "pub.leaflet.blocks.orderedList", "children": [{ "content": { "plaintext": "first" } }] } },
            { "block": { "$type": "pub.leaflet.blocks.image" } }
        ] }] });
        assert_eq!(leaflet_text(Some(&content)).unwrap(), "## Title\n\nPara\n\n- one\n  - nested\n- two\n\n1. first");
        assert!(leaflet_text(Some(&json!({ "$type": "blog.pckt.content" }))).is_none());
        let rec = json!({ "site": "https://a.b", "title": "T", "content": content, "langs": ["en"], "publishedAt": "2026-11-01T10:00:00Z" });
        let out = to_article_record(&rec, None, now()).unwrap();
        assert!(out["text"].as_str().unwrap().starts_with("## Title"));
        assert_eq!(out["platform"], "pub.leaflet.content");
        assert_eq!(out["langs"], json!(["en"]));
    }

    #[test]
    fn policy_allowlist_platforms_and_blocks() {
        let p = Policy {
            allow: ["did:plc:friend".to_string()].into(),
            platforms: ["pub.leaflet.content".to_string()].into(),
            block: ["did:plc:spam".to_string()].into(),
        };
        assert_eq!(p.accepts("did:plc:friend", None), Some(true), "белый список — с любой площадки");
        assert_eq!(p.accepts("did:plc:x", Some("pub.leaflet.content")), Some(false), "площадка — не доверенный, фильтр длины");
        assert_eq!(p.accepts("did:plc:x", Some("org.wordpress.html")), None);
        assert_eq!(p.accepts("did:plc:x", None), None);
        assert_eq!(p.accepts("did:plc:spam", Some("pub.leaflet.content")), None, "блок сильнее площадки");
        assert!(p.whole_network());
        assert!(!Policy { allow: ["did:plc:friend".to_string()].into(), ..Default::default() }.whole_network());
    }
}