//! weat-labeler: коллегии присяжных weat.media как AT Protocol labeler-сервисы.
//! Один процесс — все коллегии: у каждой свой адрес <id>.<LABELER_DOMAIN>, DID did:web, ключ подписи и поток меток.
//!
//!   GET  /.well-known/did.json                       — DID-документ коллегии по Host
//!   GET  /xrpc/com.atproto.label.queryLabels         — метки по uriPatterns (+ sources)
//!   GET  /xrpc/com.atproto.label.subscribeLabels     — поток меток коллегии (WebSocket, DAG-CBOR)
//!   GET  /xrpc/app.weat.labeler.describe             — коллегии и их значения меток (для сайта)
//!   POST /admin/labels                               — поставить/снять метку (Bearer LABELER_ADMIN_TOKEN, только AppView)

mod collegia;
mod sign;

use std::{collections::HashMap, net::SocketAddr, sync::Arc};

use axum::{
    Json, Router,
    extract::{
        Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use ipld_core::ipld::Ipld;
use k256::ecdsa::SigningKey;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use tokio::sync::broadcast;

use collegia::Collegium;
use sign::Unsigned;

#[derive(Clone)]
struct Labeler {
    c: &'static Collegium,
    did: String,
    host: String,
    key: SigningKey,
}

#[derive(Clone)]
struct AppState {
    pool: PgPool,
    labelers: Arc<HashMap<&'static str, Labeler>>,
    admin_token: Arc<String>,
    /// новая метка (seq, src) — подписчикам subscribeLabels
    tx: broadcast::Sender<i64>,
}

#[derive(sqlx::FromRow, Clone)]
struct Row {
    seq: i64,
    src: String,
    uri: String,
    cid: Option<String>,
    val: String,
    neg: bool,
    cts: String,
    sig: Vec<u8>,
}

impl Row {
    fn json(&self) -> Value {
        let mut v = json!({ "ver": 1, "src": self.src, "uri": self.uri, "val": self.val, "cts": self.cts, "sig": { "$bytes": STANDARD.encode(&self.sig) } });
        if let Some(cid) = &self.cid {
            v["cid"] = json!(cid);
        }
        if self.neg {
            v["neg"] = json!(true);
        }
        v
    }

    fn ipld(&self) -> Ipld {
        let unsigned = Unsigned { src: self.src.clone(), uri: self.uri.clone(), cid: self.cid.clone(), val: self.val.clone(), neg: self.neg, cts: self.cts.clone() };
        let Ipld::Map(mut m) = unsigned.to_ipld() else { unreachable!() };
        m.insert("sig".into(), Ipld::Bytes(self.sig.clone()));
        Ipld::Map(m)
    }
}

fn env(name: &str, default: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| default.to_string())
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let domain = env("LABELER_DOMAIN", "justice.weat.media");
    let admin_token = std::env::var("LABELER_ADMIN_TOKEN").expect("LABELER_ADMIN_TOKEN");
    assert!(admin_token.len() >= 32, "LABELER_ADMIN_TOKEN: не короче 32 символов");
    // ключи коллегий: LABELER_KEYS="spam:<hex>,tech:<hex>,…" — 32 байта secp256k1 на коллегию
    let pairs = |name: &str| -> HashMap<String, String> {
        env(name, "")
            .split(',')
            .filter_map(|kv| kv.split_once(':').map(|(k, v)| (k.trim().to_string(), v.trim().to_string())))
            .collect()
    };
    let keys = pairs("LABELER_KEYS");
    // DID коллегии в сети PLC (для Bluesky): LABELER_DIDS="tech=did:plc:…,spam=did:plc:…"; без него — did:web
    let dids: HashMap<String, String> = env("LABELER_DIDS", "")
        .split(',')
        .filter_map(|kv| kv.split_once('=').map(|(k, v)| (k.trim().to_string(), v.trim().to_string())))
        .filter(|(_, v)| v.starts_with("did:plc:"))
        .collect();

    let mut labelers = HashMap::new();
    for c in collegia::ALL {
        let Some(hex) = keys.get(c.id) else {
            tracing::warn!(collegium = c.id, "нет ключа в LABELER_KEYS — коллегия выключена");
            continue;
        };
        let key = sign::key_from_hex(hex).unwrap_or_else(|e| panic!("LABELER_KEYS {}: {e}", c.id));
        let host = format!("{}.{domain}", c.id);
        let did = dids.get(c.id).cloned().unwrap_or_else(|| format!("did:web:{host}"));
        labelers.insert(c.id, Labeler { c, did, host, key });
    }
    assert!(!labelers.is_empty(), "ни одной коллегии: задайте LABELER_KEYS");

    let pool = sqlx::postgres::PgPoolOptions::new().max_connections(5).connect(&database_url).await.expect("postgres");
    sqlx::migrate!("./migrations").run(&pool).await.expect("migrations");

    let (tx, _) = broadcast::channel(1024);
    let state = AppState { pool, labelers: Arc::new(labelers), admin_token: Arc::new(admin_token), tx };

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/.well-known/did.json", get(did_doc))
        .route("/.well-known/atproto-did", get(atproto_did))
        .route("/xrpc/com.atproto.label.queryLabels", get(query_labels))
        .route("/xrpc/com.atproto.label.subscribeLabels", get(subscribe))
        .route("/xrpc/app.weat.labeler.describe", get(describe))
        .route("/admin/labels", post(put_label))
        .with_state(state);

    let port: u16 = env("PORT", "8791").parse().expect("PORT");
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!(%addr, "labeler");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .unwrap();
}

/// коллегия по Host: <id>.<домен>; на внутреннем адресе (labeler:8791) — None
fn by_host<'a>(s: &'a AppState, headers: &HeaderMap) -> Option<&'a Labeler> {
    let host = headers.get("host")?.to_str().ok()?.split(':').next()?.to_ascii_lowercase();
    s.labelers.values().find(|l| l.host == host)
}

/// handle <id>.justice.weat.media → DID коллегии (нужно учётке коллегии на PDS для Bluesky)
async fn atproto_did(State(s): State<AppState>, headers: HeaderMap) -> Response {
    match by_host(&s, &headers) {
        Some(l) => ([("content-type", "text/plain")], l.did.clone()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// did:web-документ; для коллегии на did:plc документ живёт в plc.directory
async fn did_doc(State(s): State<AppState>, headers: HeaderMap) -> Response {
    let Some(l) = by_host(&s, &headers) else { return StatusCode::NOT_FOUND.into_response() };
    if !l.did.starts_with("did:web:") {
        return StatusCode::NOT_FOUND.into_response();
    }
    Json(json!({
        "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/multikey/v1"],
        "id": l.did,
        "alsoKnownAs": [format!("at://{}", l.host)],
        "verificationMethod": [{
            "id": format!("{}#atproto_label", l.did),
            "type": "Multikey",
            "controller": l.did,
            "publicKeyMultibase": sign::multikey(l.key.verifying_key()),
        }],
        "service": [{ "id": "#atproto_labeler", "type": "AtprotoLabeler", "serviceEndpoint": format!("https://{}", l.host) }],
    }))
    .into_response()
}

async fn describe(State(s): State<AppState>) -> Json<Value> {
    let mut list: Vec<&Labeler> = s.labelers.values().collect();
    list.sort_by_key(|l| l.c.id);
    Json(json!({
        "labelers": list.iter().map(|l| json!({
            "id": l.c.id, "did": l.did, "handle": l.host, "name": l.c.name, "description": l.c.description,
            "publicKeyMultibase": sign::multikey(l.key.verifying_key()),
            "labels": l.c.labels.iter().map(|v| json!({ "value": v.value, "description": v.description, "defaultAction": v.default_action, "adult": v.adult })).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
    }))
}

#[derive(Deserialize)]
struct QueryParams {
    #[serde(rename = "uriPatterns")]
    uri_patterns: Option<String>,
    sources: Option<String>,
    limit: Option<i64>,
    cursor: Option<i64>,
}

/// uriPatterns — через запятую; «*» в конце — префикс (как в спецификации). Отдаём действующее состояние:
/// по каждой (src, uri, val) — последняя запись, снятые (neg) не возвращаем
async fn query_labels(State(s): State<AppState>, Query(q): Query<QueryParams>) -> Response {
    let patterns: Vec<String> = q.uri_patterns.unwrap_or_default().split(',').map(str::trim).filter(|p| !p.is_empty() && p.len() <= 400).take(100).map(String::from).collect();
    if patterns.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "InvalidRequest", "message": "uriPatterns обязателен" }))).into_response();
    }
    let like: Vec<String> = patterns
        .iter()
        .map(|p| {
            let esc = p.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
            match esc.strip_suffix('*') {
                Some(prefix) => format!("{prefix}%"),
                None => esc,
            }
        })
        .collect();
    let sources: Vec<String> = q.sources.unwrap_or_default().split(',').map(str::trim).filter(|x| !x.is_empty()).map(String::from).collect();
    let limit = q.limit.unwrap_or(50).clamp(1, 250);
    let rows = sqlx::query_as::<_, Row>(
        "SELECT * FROM (
           SELECT DISTINCT ON (src, uri, val) seq, src, uri, cid, val, neg, cts, sig FROM labels
           WHERE uri LIKE ANY($1) AND (cardinality($2::text[]) = 0 OR src = ANY($2)) AND seq > $3
           ORDER BY src, uri, val, seq DESC
         ) t WHERE NOT neg ORDER BY seq LIMIT $4",
    )
    .bind(&like)
    .bind(&sources)
    .bind(q.cursor.unwrap_or(0))
    .bind(limit)
    .fetch_all(&s.pool)
    .await;
    match rows {
        Ok(rows) => {
            let cursor = if rows.len() as i64 == limit { rows.last().map(|r| r.seq.to_string()) } else { None };
            Json(json!({ "cursor": cursor, "labels": rows.iter().map(Row::json).collect::<Vec<_>>() })).into_response()
        }
        Err(err) => {
            tracing::error!(%err, "queryLabels");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

#[derive(Deserialize)]
struct SubParams {
    cursor: Option<i64>,
}

async fn subscribe(State(s): State<AppState>, headers: HeaderMap, Query(q): Query<SubParams>, ws: WebSocketUpgrade) -> Response {
    let Some(l) = by_host(&s, &headers).cloned() else { return StatusCode::NOT_FOUND.into_response() };
    ws.on_upgrade(move |socket| stream(s, l.did, q.cursor, socket))
}

/// кадр subscribeLabels: DAG-CBOR заголовок {op:1, t:"#labels"} + тело {seq, labels:[…]}
fn frame(row: &Row) -> Vec<u8> {
    let header = Ipld::Map([("op".to_string(), Ipld::Integer(1)), ("t".to_string(), Ipld::String("#labels".into()))].into_iter().collect());
    let body = Ipld::Map([("seq".to_string(), Ipld::Integer(row.seq.into())), ("labels".to_string(), Ipld::List(vec![row.ipld()]))].into_iter().collect());
    let mut out = serde_ipld_dagcbor::to_vec(&header).expect("cbor");
    out.extend(serde_ipld_dagcbor::to_vec(&body).expect("cbor"));
    out
}

async fn stream(s: AppState, src: String, cursor: Option<i64>, mut socket: WebSocket) {
    let mut rx = s.tx.subscribe();
    // с курсором — сначала история после него, затем живой поток
    let mut last = cursor.unwrap_or(i64::MAX);
    if cursor.is_some() {
        loop {
            let batch = sqlx::query_as::<_, Row>("SELECT seq, src, uri, cid, val, neg, cts, sig FROM labels WHERE src = $1 AND seq > $2 ORDER BY seq LIMIT 500")
                .bind(&src)
                .bind(last)
                .fetch_all(&s.pool)
                .await
                .unwrap_or_default();
            if batch.is_empty() {
                break;
            }
            for r in &batch {
                if socket.send(Message::Binary(frame(r).into())).await.is_err() {
                    return;
                }
                last = r.seq;
            }
        }
    }
    loop {
        tokio::select! {
            got = rx.recv() => match got {
                Ok(seq) if seq > last || last == i64::MAX => {
                    let row = sqlx::query_as::<_, Row>("SELECT seq, src, uri, cid, val, neg, cts, sig FROM labels WHERE seq = $1 AND src = $2")
                        .bind(seq).bind(&src).fetch_optional(&s.pool).await.ok().flatten();
                    if let Some(r) = row {
                        if socket.send(Message::Binary(frame(&r).into())).await.is_err() { return; }
                        last = r.seq;
                    }
                }
                Ok(_) => {}
                // отстал — клиент переподключится с курсором
                Err(broadcast::error::RecvError::Lagged(_)) => return,
                Err(broadcast::error::RecvError::Closed) => return,
            },
            msg = socket.recv() => if !matches!(msg, Some(Ok(_))) { return },
        }
    }
}

#[derive(Deserialize)]
struct PutLabel {
    labeler: String,
    uri: String,
    cid: Option<String>,
    val: String,
    #[serde(default)]
    neg: bool,
    actor: Option<String>,
}

fn safe_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// тело разбираем после проверки токена: без доступа — 401, а не ошибка формата
async fn put_label(State(s): State<AppState>, headers: HeaderMap, body: axum::body::Bytes) -> Response {
    let token = headers.get("authorization").and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")).unwrap_or("");
    if !safe_eq(token.as_bytes(), s.admin_token.as_bytes()) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let bad = |m: &str| (StatusCode::BAD_REQUEST, Json(json!({ "error": "InvalidRequest", "message": m }))).into_response();
    let Ok(b) = serde_json::from_slice::<PutLabel>(&body) else { return bad("ожидается {labeler, uri, val, neg?, cid?}") };
    let Some(l) = s.labelers.get(b.labeler.as_str()) else { return bad("нет такой коллегии") };
    if !l.c.labels.iter().any(|v| v.value == b.val) {
        return bad("эта коллегия не выдаёт такую метку");
    }
    if !(b.uri.starts_with("at://did:") || b.uri.starts_with("did:")) || b.uri.len() > 400 {
        return bad("uri: at://… или did:…");
    }
    let unsigned = Unsigned { src: l.did.clone(), uri: b.uri, cid: b.cid.filter(|c| !c.is_empty()), val: b.val, neg: b.neg, cts: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true) };
    let sig = sign::sign(&l.key, &unsigned);
    let row = sqlx::query_as::<_, Row>(
        "INSERT INTO labels (src, uri, cid, val, neg, cts, sig, actor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING seq, src, uri, cid, val, neg, cts, sig",
    )
    .bind(&unsigned.src)
    .bind(&unsigned.uri)
    .bind(&unsigned.cid)
    .bind(&unsigned.val)
    .bind(unsigned.neg)
    .bind(&unsigned.cts)
    .bind(sig.as_slice())
    .bind(b.actor)
    .fetch_one(&s.pool)
    .await;
    match row {
        Ok(r) => {
            let _ = s.tx.send(r.seq);
            (StatusCode::CREATED, Json(r.json())).into_response()
        }
        Err(err) => {
            tracing::error!(%err, "put label");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}
