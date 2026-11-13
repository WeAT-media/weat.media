//! RSS 2.0 по постоянным адресам: статьи автора и комментарии к статье.
//!   /rss/author/{handle}
//!   /rss/comments/{did}/{rkey}

use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Utc};
use serde_json::Value;

use crate::api::AppState;
use crate::index;
use crate::record::COLLECTION;

pub fn esc(s: &str) -> String {
    s.chars()
        // управляющие символы недопустимы в XML 1.0
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
        .map(|c| match c {
            '&' => "&amp;".to_string(),
            '<' => "&lt;".to_string(),
            '>' => "&gt;".to_string(),
            '"' => "&quot;".to_string(),
            '\'' => "&apos;".to_string(),
            c => c.to_string(),
        })
        .collect()
}

/// id статьи на сайте — как src/lib/remoteFeed.ts: rkey + 6 последних символов DID
pub fn site_id(did: &str, rkey: &str) -> String {
    let tail: String = did
        .chars()
        .rev()
        .take(6)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{rkey}-{tail}")
}

pub struct Item {
    pub title: String,
    pub link: String,
    pub guid: String,
    pub description: String,
    pub author: Option<String>,
    pub date: DateTime<Utc>,
}

pub fn channel(
    title: &str,
    link: &str,
    self_url: &str,
    description: &str,
    items: &[Item],
) -> String {
    let mut out = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<rss version=\"2.0\" xmlns:atom=\"http://www.w3.org/2005/Atom\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n<channel>\n",
    );
    out += &format!(
        "<title>{}</title>\n<link>{}</link>\n<description>{}</description>\n",
        esc(title),
        esc(link),
        esc(description)
    );
    out += &format!(
        "<atom:link href=\"{}\" rel=\"self\" type=\"application/rss+xml\"/>\n<language>ru</language>\n",
        esc(self_url)
    );
    if let Some(first) = items.first() {
        out += &format!(
            "<lastBuildDate>{}</lastBuildDate>\n",
            first.date.to_rfc2822()
        );
    }
    for i in items {
        out += "<item>\n";
        out += &format!(
            "<title>{}</title>\n<link>{}</link>\n<guid isPermaLink=\"false\">{}</guid>\n",
            esc(&i.title),
            esc(&i.link),
            esc(&i.guid)
        );
        out += &format!(
            "<pubDate>{}</pubDate>\n<description>{}</description>\n",
            i.date.to_rfc2822(),
            esc(&i.description)
        );
        if let Some(a) = &i.author {
            out += &format!("<dc:creator>{}</dc:creator>\n", esc(a));
        }
        out += "</item>\n";
    }
    out + "</channel>\n</rss>\n"
}

fn xml(body: String) -> Response {
    (
        [
            (header::CONTENT_TYPE, "application/rss+xml; charset=utf-8"),
            (header::CACHE_CONTROL, "public, max-age=300"),
        ],
        body,
    )
        .into_response()
}

fn excerpt(rec: &Value) -> String {
    rec.get("excerpt")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| {
            rec.get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .chars()
                .take(400)
                .collect()
        })
}

pub async fn author(State(s): State<AppState>, Path(handle): Path<String>) -> Response {
    let handle = handle.trim_end_matches(".xml").to_lowercase();
    if handle.len() > 253 {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let Ok(Some(did)) = index::did_by_handle(&s.pool, &handle).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let q = index::Query {
        limit: 50,
        did: Some(did.clone()),
        ..Default::default()
    };
    let Ok(rows) = index::feed(&s.pool, &q).await else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let items: Vec<Item> = rows
        .iter()
        .map(|r| {
            let rkey = r.uri.rsplit('/').next().unwrap_or_default();
            Item {
                title: r
                    .record
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("Без названия")
                    .to_string(),
                link: format!("{}/article/{}", s.site_url, site_id(&r.did, rkey)),
                guid: r.uri.clone(),
                description: excerpt(&r.record),
                author: Some(handle.clone()),
                date: r.created_at,
            }
        })
        .collect();
    let link = format!("{}/profile/{handle}", s.site_url);
    xml(channel(
        &format!("@{handle} — {}", s.site_name),
        &link,
        &format!("{}/rss/author/{handle}", s.site_url),
        &format!("Статьи @{handle}"),
        &items,
    ))
}

pub async fn comments(
    State(s): State<AppState>,
    Path((did, rkey)): Path<(String, String)>,
) -> Response {
    let rkey = rkey.trim_end_matches(".xml");
    if !did.starts_with("did:") || did.len() > 200 || rkey.is_empty() || rkey.len() > 64 {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let uri = format!("at://{did}/{COLLECTION}/{rkey}");
    let Ok(Some(article)) = index::article(&s.pool, &uri).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(rows) = index::comments_of(&s.pool, &uri, 100).await else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let title = article
        .record
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Статья")
        .to_string();
    let link = format!("{}/article/{}", s.site_url, site_id(&did, rkey));
    let items: Vec<Item> = rows
        .iter()
        .map(|c| {
            let who = c.handle.clone().unwrap_or_else(|| c.did.clone());
            Item {
                title: format!("@{who}: {}", c.text.chars().take(80).collect::<String>()),
                link: link.clone(),
                guid: c.uri.clone(),
                description: c.text.clone(),
                author: Some(who),
                date: c.created_at,
            }
        })
        .collect();
    xml(channel(
        &format!("Комментарии · {title}"),
        &link,
        &format!("{}/rss/comments/{did}/{rkey}", s.site_url),
        &format!("Обсуждение «{title}»"),
        &items,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_and_builds_valid_channel() {
        assert_eq!(esc("a<b>&\"'\u{1}"), "a&lt;b&gt;&amp;&quot;&apos;");
        assert_eq!(
            site_id("did:plc:3og2bfz2njcduy5z32ajq2gr", "3n25dueyesc2w"),
            "3n25dueyesc2w-ajq2gr"
        );
        let x = channel(
            "T&",
            "https://w",
            "https://w/rss",
            "d",
            &[Item {
                title: "<x>".into(),
                link: "https://w/a".into(),
                guid: "at://g".into(),
                description: "e".into(),
                author: None,
                date: Utc::now(),
            }],
        );
        assert!(x.contains("<title>&lt;x&gt;</title>"));
        assert!(x.contains("<title>T&amp;</title>"));
        assert!(x.starts_with("<?xml"));
    }
}
