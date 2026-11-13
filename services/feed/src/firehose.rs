//! Поток событий PDS (com.atproto.sync.subscribeRepos): CBOR-кадры с CAR-блоками.
//! Берём только media.weat.article, плюс #identity (смена handle) и #account (удаление).

use std::collections::HashMap;
use std::io::Cursor;
use std::time::Duration;

use chrono::Utc;
use futures_util::StreamExt;
use ipld_core::cid::Cid;
use ipld_core::ipld::Ipld;
use sqlx::PgPool;
use tokio_tungstenite::tungstenite::Message;

use crate::index;
use crate::record::{
    COLLECTION, COMMENT, LIKE, ipld_to_json, parse_article, parse_comment, parse_like,
};

/// событие, разобранное до того, что нужно индексу
#[derive(Debug, PartialEq)]
pub enum Event {
    Upsert {
        seq: i64,
        did: String,
        collection: &'static str,
        rkey: String,
        cid: String,
        record: serde_json::Value,
    },
    Delete {
        seq: i64,
        did: String,
        collection: &'static str,
        rkey: String,
    },
    Handle {
        seq: i64,
        did: String,
        handle: String,
    },
    RepoGone {
        seq: i64,
        did: String,
    },
    Skip {
        seq: Option<i64>,
    },
}

fn get<'a>(m: &'a Ipld, k: &str) -> Option<&'a Ipld> {
    match m {
        Ipld::Map(map) => map.get(k),
        _ => None,
    }
}
fn str_of<'a>(m: &'a Ipld, k: &str) -> Option<&'a str> {
    match get(m, k)? {
        Ipld::String(s) => Some(s),
        _ => None,
    }
}
fn int_of(m: &Ipld, k: &str) -> Option<i64> {
    match get(m, k)? {
        Ipld::Integer(i) => i64::try_from(*i).ok(),
        _ => None,
    }
}

/// CAR-блоки коммита: cid → байты записи
async fn car_blocks(bytes: &[u8]) -> HashMap<Cid, Vec<u8>> {
    let mut out = HashMap::new();
    let Ok(mut reader) = iroh_car::CarReader::new(bytes).await else {
        return out;
    };
    while let Ok(Some((cid, data))) = reader.next_block().await {
        out.insert(cid, data);
    }
    out
}

/// Кадр → события. Один коммит может нести несколько операций.
pub async fn decode_frame(frame: &[u8]) -> Vec<Event> {
    let mut it = serde_ipld_dagcbor::de::iter_from_reader::<Ipld, _>(Cursor::new(frame));
    let (Some(Ok(header)), Some(Ok(body))) = (it.next(), it.next()) else {
        return vec![Event::Skip { seq: None }];
    };
    let seq = int_of(&body, "seq");
    if int_of(&header, "op") != Some(1) {
        return vec![Event::Skip { seq }];
    }
    let Some(seq_v) = seq else {
        return vec![Event::Skip { seq }];
    };
    match str_of(&header, "t") {
        Some("#commit") => {
            let Some(did) = str_of(&body, "repo").map(str::to_string) else {
                return vec![Event::Skip { seq }];
            };
            let Some(Ipld::List(ops)) = get(&body, "ops") else {
                return vec![Event::Skip { seq }];
            };
            let coll = |op: &Ipld| -> Option<&'static str> {
                let p = str_of(op, "path")?;
                [COLLECTION, COMMENT, LIKE]
                    .into_iter()
                    .find(|c| p.starts_with(&format!("{c}/")))
            };
            let ours: Vec<(&Ipld, &'static str)> = ops
                .iter()
                .filter_map(|op| coll(op).map(|c| (op, c)))
                .collect();
            if ours.is_empty() {
                return vec![Event::Skip { seq }];
            }
            let blocks = match get(&body, "blocks") {
                Some(Ipld::Bytes(b)) => car_blocks(b).await,
                _ => HashMap::new(),
            };
            let mut out = vec![];
            for (op, collection) in ours {
                let rkey = str_of(op, "path")
                    .unwrap()
                    .trim_start_matches(&format!("{collection}/"))
                    .to_string();
                match str_of(op, "action") {
                    Some("create") | Some("update") => {
                        let Some(Ipld::Link(cid)) = get(op, "cid") else {
                            continue;
                        };
                        let Some(data) = blocks.get(cid) else {
                            continue;
                        };
                        let Ok(rec) = serde_ipld_dagcbor::from_slice::<Ipld>(data) else {
                            continue;
                        };
                        out.push(Event::Upsert {
                            seq: seq_v,
                            did: did.clone(),
                            collection,
                            rkey,
                            cid: cid.to_string(),
                            record: ipld_to_json(rec),
                        });
                    }
                    Some("delete") => out.push(Event::Delete {
                        seq: seq_v,
                        did: did.clone(),
                        collection,
                        rkey,
                    }),
                    _ => {}
                }
            }
            if out.is_empty() {
                vec![Event::Skip { seq }]
            } else {
                out
            }
        }
        Some("#identity") => match (str_of(&body, "did"), str_of(&body, "handle")) {
            (Some(did), Some(handle)) => vec![Event::Handle {
                seq: seq_v,
                did: did.into(),
                handle: handle.into(),
            }],
            _ => vec![Event::Skip { seq }],
        },
        Some("#account") => match (str_of(&body, "did"), get(&body, "active")) {
            (Some(did), Some(Ipld::Bool(false)))
                if matches!(str_of(&body, "status"), Some("deleted") | Some("takendown")) =>
            {
                vec![Event::RepoGone {
                    seq: seq_v,
                    did: did.into(),
                }]
            }
            _ => vec![Event::Skip { seq }],
        },
        _ => vec![Event::Skip { seq }],
    }
}

pub async fn apply(
    pool: &PgPool,
    pds: &crate::backfill::Pds,
    ev: Event,
) -> sqlx::Result<Option<i64>> {
    Ok(match ev {
        Event::Upsert {
            seq,
            did,
            collection,
            rkey,
            cid,
            record,
        } => {
            let uri = format!("at://{did}/{collection}/{rkey}");
            index::seen(pool, &did, Utc::now()).await?;
            if collection == COMMENT {
                match parse_comment(&record, Utc::now()) {
                    Some(c) => index::upsert_comment(pool, &uri, &did, &c).await?,
                    None => index::delete(pool, &uri).await?,
                }
            } else if collection == LIKE {
                match parse_like(&record, Utc::now()) {
                    Some(l) => index::upsert_like(pool, &uri, &did, &l).await?,
                    None => index::delete(pool, &uri).await?,
                }
            } else {
                match parse_article(&record, Utc::now()) {
                    Some(a) => index::upsert(pool, &uri, &did, &rkey, &cid, &a, &record).await?,
                    // запись перестала быть статьёй (обновили без текста) — убираем
                    None => index::delete(pool, &uri).await?,
                }
            }
            if !index::has_handle(pool, &did).await? {
                if let Some(h) = pds.handle(&did).await {
                    index::set_handle(pool, &did, &h).await?;
                }
            }
            Some(seq)
        }
        Event::Delete {
            seq,
            did,
            collection,
            rkey,
        } => {
            index::delete(pool, &format!("at://{did}/{collection}/{rkey}")).await?;
            Some(seq)
        }
        Event::Handle { seq, did, handle } => {
            index::set_handle(pool, &did, &handle).await?;
            Some(seq)
        }
        Event::RepoGone { seq, did } => {
            index::delete_repo(pool, &did).await?;
            Some(seq)
        }
        Event::Skip { seq } => seq,
    })
}

/// Подписка с переподключением; позиция сохраняется раз в секунду
pub async fn run(pool: PgPool, pds: crate::backfill::Pds, ws_base: String) {
    let source = ws_base.clone();
    let mut backoff = Duration::from_secs(1);
    loop {
        let cursor = index::cursor(&pool, &source).await.ok().flatten();
        let url = match cursor {
            Some(c) => format!("{ws_base}/xrpc/com.atproto.sync.subscribeRepos?cursor={c}"),
            None => format!("{ws_base}/xrpc/com.atproto.sync.subscribeRepos"),
        };
        match tokio_tungstenite::connect_async(&url).await {
            Ok((mut ws, _)) => {
                tracing::info!(%url, "firehose connected");
                backoff = Duration::from_secs(1);
                let mut last_seq: Option<i64> = None;
                let mut flush = tokio::time::interval(Duration::from_secs(1));
                loop {
                    tokio::select! {
                        msg = ws.next() => match msg {
                            Some(Ok(Message::Binary(frame))) => {
                                for ev in decode_frame(&frame).await {
                                    match apply(&pool, &pds, ev).await {
                                        Ok(Some(s)) => last_seq = Some(last_seq.map_or(s, |l| l.max(s))),
                                        Ok(None) => {}
                                        Err(err) => tracing::error!(%err, "index write"),
                                    }
                                }
                            }
                            Some(Ok(Message::Close(_))) | None => break,
                            Some(Ok(_)) => {}
                            Some(Err(err)) => { tracing::warn!(%err, "firehose read"); break }
                        },
                        _ = flush.tick() => if let Some(s) = last_seq.take() {
                            if let Err(err) = index::set_cursor(&pool, &source, s).await { tracing::error!(%err, "cursor") }
                        }
                    }
                }
                if let Some(s) = last_seq {
                    let _ = index::set_cursor(&pool, &source, s).await;
                }
            }
            Err(err) => tracing::warn!(%err, %url, "firehose connect"),
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_secs(60));
    }
}
