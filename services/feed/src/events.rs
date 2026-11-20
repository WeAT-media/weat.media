//! Живые события ленты (SSE /feed-api/stream): статья появилась, изменилась или удалена из индекса.
//! Источник — сами записи индекса (index::upsert / index::delete), поэтому событие приходит из любого потока:
//! firehose наших PDS, Jetstream standard.site, догрузки. Повтор той же версии (тот же CID) события не даёт.

use std::sync::OnceLock;

use chrono::{DateTime, Utc};
use serde::Serialize;
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArticleEvent {
    /// created | updated | deleted
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub uri: String,
    pub did: String,
    /// короткий id для адреса страницы: /article/<rkey>-<6 последних символов DID>
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paid: Option<bool>,
    /// внешняя запись (standard.site, перепечатка с сайта) — домен источника
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_site: Option<String>,
    pub at: DateTime<Utc>,
}

/// медленный подписчик пропускает старые события (Lagged), а не тормозит индекс
const CAPACITY: usize = 1024;

fn channel() -> &'static broadcast::Sender<ArticleEvent> {
    static TX: OnceLock<broadcast::Sender<ArticleEvent>> = OnceLock::new();
    TX.get_or_init(|| broadcast::channel(CAPACITY).0)
}

pub fn subscribe() -> broadcast::Receiver<ArticleEvent> {
    channel().subscribe()
}

/// at://did/collection/rkey → (did, короткий id)
pub fn short_id(uri: &str) -> Option<(String, String)> {
    let rest = uri.strip_prefix("at://")?;
    let mut parts = rest.split('/');
    let (did, _coll, rkey) = (parts.next()?, parts.next()?, parts.next()?);
    let tail: String = did.chars().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect();
    Some((did.to_string(), format!("{rkey}-{tail}")))
}

pub fn emit(mut ev: ArticleEvent) {
    ev.at = Utc::now();
    // нет подписчиков — не ошибка
    let _ = channel().send(ev);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_id_matches_page_address() {
        assert_eq!(
            short_id("at://did:plc:abcdefghijkl123456/media.weat.article/3kabc"),
            Some(("did:plc:abcdefghijkl123456".into(), "3kabc-123456".into()))
        );
        assert_eq!(short_id("https://x"), None);
    }

    #[tokio::test]
    async fn subscribers_receive_events() {
        let mut rx = subscribe();
        emit(ArticleEvent { kind: "created", uri: "at://did:plc:x/media.weat.article/1".into(), did: "did:plc:x".into(), id: "1-plc:x".into(), title: Some("T".into()), created_at: None, paid: Some(false), source_site: None, at: Utc::now() });
        assert_eq!(rx.recv().await.unwrap().title.as_deref(), Some("T"));
    }
}
