//! DAG-CBOR → JSON и разбор записи статьи в поля индекса.

use base64::Engine;
use chrono::{DateTime, Utc};
use ipld_core::ipld::Ipld;
use serde_json::{Map, Value};

pub const COLLECTION: &str = "media.weat.article";
pub const COMMENT: &str = "media.weat.comment";
pub const LIKE: &str = "media.weat.like";

/// JSON как в XRPC: ссылки — {"$link": cid}, байты — {"$bytes": base64}
pub fn ipld_to_json(v: Ipld) -> Value {
    match v {
        Ipld::Null => Value::Null,
        Ipld::Bool(b) => Value::Bool(b),
        Ipld::Integer(i) => i64::try_from(i).map(Value::from).unwrap_or(Value::Null),
        Ipld::Float(f) => serde_json::Number::from_f64(f)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        Ipld::String(s) => Value::String(s),
        Ipld::Bytes(b) => {
            serde_json::json!({ "$bytes": base64::engine::general_purpose::STANDARD_NO_PAD.encode(b) })
        }
        Ipld::List(l) => Value::Array(l.into_iter().map(ipld_to_json).collect()),
        Ipld::Map(m) => Value::Object(
            m.into_iter()
                .map(|(k, v)| (k, ipld_to_json(v)))
                .collect::<Map<_, _>>(),
        ),
        Ipld::Link(c) => serde_json::json!({ "$link": c.to_string() }),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Article {
    pub title: String,
    pub created_at: DateTime<Utc>,
    pub tags: Vec<String>,
    pub langs: Vec<String>,
    pub source_site: Option<String>,
    pub paid: bool,
}

fn strings(v: Option<&Value>, max: usize, len: usize) -> Vec<String> {
    v.and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .filter(|s| !s.is_empty() && s.len() <= len)
                .take(max)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// None — не статья (нет заголовка или текста); такие записи не индексируем
pub fn parse_article(rec: &Value, now: DateTime<Utc>) -> Option<Article> {
    let title = rec.get("title")?.as_str()?.trim();
    rec.get("text")?.as_str()?;
    if title.is_empty() {
        return None;
    }
    // дата из будущего (часы автора, подделка) не должна закреплять запись наверху ленты
    let created_at = rec
        .get("createdAt")
        .and_then(Value::as_str)
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc))
        .filter(|d| *d <= now)
        .unwrap_or(now);
    Some(Article {
        title: title.chars().take(300).collect(),
        created_at,
        tags: strings(rec.get("tags"), 20, 64),
        langs: strings(rec.get("langs"), 3, 10),
        source_site: rec
            .get("source")
            .and_then(|s| s.get("site"))
            .and_then(Value::as_str)
            .map(str::to_string),
        paid: rec.get("paywall").is_some(),
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct CommentRec {
    pub subject: String,
    pub parent: Option<String>,
    pub text: String,
    pub created_at: DateTime<Utc>,
}

pub fn parse_comment(rec: &Value, now: DateTime<Utc>) -> Option<CommentRec> {
    let subject = rec.get("subject")?.get("uri")?.as_str()?;
    if !subject.starts_with("at://") || !subject.contains(&format!("/{COLLECTION}/")) {
        return None;
    }
    let text = rec.get("text")?.as_str()?.trim();
    if text.is_empty() {
        return None;
    }
    let created_at = rec
        .get("createdAt")
        .and_then(Value::as_str)
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc))
        .filter(|d| *d <= now)
        .unwrap_or(now);
    Some(CommentRec {
        subject: subject.to_string(),
        parent: rec
            .get("reply")
            .and_then(|r| r.get("parent"))
            .and_then(|p| p.get("uri"))
            .and_then(Value::as_str)
            .map(str::to_string),
        text: text.chars().take(10_000).collect(),
        created_at,
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct LikeRec {
    pub subject: String,
    pub created_at: DateTime<Utc>,
}

pub fn parse_like(rec: &Value, now: DateTime<Utc>) -> Option<LikeRec> {
    let subject = rec.get("subject")?.get("uri")?.as_str()?;
    if !subject.starts_with("at://") || !subject.contains(&format!("/{COLLECTION}/")) {
        return None;
    }
    let created_at = rec
        .get("createdAt")
        .and_then(Value::as_str)
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc))
        .filter(|d| *d <= now)
        .unwrap_or(now);
    Some(LikeRec {
        subject: subject.to_string(),
        created_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_article_and_clamps_future_dates() {
        let now = Utc::now();
        let a = parse_article(&json!({ "title": "Привет", "text": "x", "tags": ["rust", "", 5], "createdAt": "2026-01-01T00:00:00Z", "source": { "site": "habr.com" }, "paywall": { "price": 100 } }), now).unwrap();
        assert_eq!(a.tags, vec!["rust"]);
        assert_eq!(a.source_site.as_deref(), Some("habr.com"));
        assert!(a.paid);
        assert_eq!(a.created_at.to_rfc3339(), "2026-01-01T00:00:00+00:00");
        let future = parse_article(
            &json!({ "title": "t", "text": "x", "createdAt": "2999-01-01T00:00:00Z" }),
            now,
        )
        .unwrap();
        assert_eq!(future.created_at, now);
        assert!(parse_article(&json!({ "title": "", "text": "x" }), now).is_none());
        assert!(parse_article(&json!({ "text": "x" }), now).is_none());
    }

    #[test]
    fn parses_comment() {
        let now = Utc::now();
        let c = parse_comment(&json!({ "subject": { "uri": "at://did:plc:a/media.weat.article/1" }, "text": " ok ", "reply": { "parent": { "uri": "at://did:plc:b/media.weat.comment/2" } } }), now).unwrap();
        assert_eq!(c.text, "ok");
        assert_eq!(
            c.parent.as_deref(),
            Some("at://did:plc:b/media.weat.comment/2")
        );
        assert!(
            parse_comment(
                &json!({ "subject": { "uri": "https://x" }, "text": "a" }),
                now
            )
            .is_none()
        );
    }

    #[test]
    fn parses_like() {
        let now = Utc::now();
        let l = parse_like(&json!({ "subject": { "uri": "at://did:plc:a/media.weat.article/1", "cid": "bafy" }, "createdAt": "2026-01-01T00:00:00Z" }), now).unwrap();
        assert_eq!(l.subject, "at://did:plc:a/media.weat.article/1");
        assert_eq!(l.created_at.to_rfc3339(), "2026-01-01T00:00:00+00:00");
        assert!(
            parse_like(
                &json!({ "subject": { "uri": "at://did:plc:a/media.weat.comment/1" } }),
                now
            )
            .is_none()
        );
        assert!(parse_like(&json!({ "createdAt": "2026-01-01T00:00:00Z" }), now).is_none());
    }

    #[test]
    fn ipld_links_and_bytes() {
        let v = ipld_to_json(Ipld::List(vec![Ipld::Bytes(vec![1, 2]), Ipld::Integer(7)]));
        assert_eq!(v, json!([{ "$bytes": "AQI" }, 7]));
    }
}
