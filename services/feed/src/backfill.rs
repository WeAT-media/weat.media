//! Догрузка: всё, что было опубликовано до запуска индекса (listRepos + listRecords).

use chrono::Utc;
use serde::Deserialize;
use sqlx::PgPool;

use crate::index;
use crate::record::{COLLECTION, COMMENT, LIKE, parse_article, parse_comment, parse_like};

#[derive(Clone)]
pub struct Pds {
    pub base: String,
    pub http: reqwest::Client,
}

#[derive(Deserialize)]
struct Repos {
    repos: Vec<RepoRef>,
    cursor: Option<String>,
}
#[derive(Deserialize)]
struct RepoRef {
    did: String,
    #[serde(default = "yes")]
    active: bool,
}
fn yes() -> bool {
    true
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
    value: serde_json::Value,
}

impl Pds {
    async fn get<T: for<'de> Deserialize<'de>>(&self, nsid: &str, q: &[(&str, &str)]) -> Option<T> {
        let res = self
            .http
            .get(format!("{}/xrpc/{nsid}", self.base))
            .query(q)
            .send()
            .await
            .ok()?;
        if !res.status().is_success() {
            return None;
        }
        res.json().await.ok()
    }

    pub async fn handle(&self, did: &str) -> Option<String> {
        #[derive(Deserialize)]
        struct D {
            handle: String,
        }
        self.get::<D>("com.atproto.repo.describeRepo", &[("repo", did)])
            .await
            .map(|d| d.handle)
    }
}

pub async fn run(pool: &PgPool, pds: &Pds) -> sqlx::Result<usize> {
    let mut n = 0;
    let mut cursor: Option<String> = None;
    loop {
        let mut q = vec![("limit", "500")];
        if let Some(c) = cursor.as_deref() {
            q.push(("cursor", c));
        }
        let Some(page) = pds.get::<Repos>("com.atproto.sync.listRepos", &q).await else {
            break;
        };
        for repo in page.repos.into_iter().filter(|r| r.active) {
            if let Some(h) = pds.handle(&repo.did).await {
                index::set_handle(pool, &repo.did, &h).await?;
            }
            for collection in [COLLECTION, COMMENT, LIKE] {
                let mut rc: Option<String> = None;
                loop {
                    let mut q = vec![
                        ("repo", repo.did.as_str()),
                        ("collection", collection),
                        ("limit", "100"),
                    ];
                    if let Some(c) = rc.as_deref() {
                        q.push(("cursor", c));
                    }
                    let Some(recs) = pds.get::<Records>("com.atproto.repo.listRecords", &q).await
                    else {
                        break;
                    };
                    for r in &recs.records {
                        let rkey = r.uri.rsplit('/').next().unwrap_or_default();
                        if collection == COMMENT {
                            if let Some(c) = parse_comment(&r.value, Utc::now()) {
                                index::upsert_comment(pool, &r.uri, &repo.did, &c).await?;
                            }
                        } else if collection == LIKE {
                            if let Some(l) = parse_like(&r.value, Utc::now()) {
                                index::upsert_like(pool, &r.uri, &repo.did, &l).await?;
                            }
                        } else if let Some(a) = parse_article(&r.value, Utc::now()) {
                            index::upsert(pool, &r.uri, &repo.did, rkey, &r.cid, &a, &r.value)
                                .await?;
                            n += 1;
                        }
                    }
                    match recs.cursor {
                        Some(c) if !recs.records.is_empty() => rc = Some(c),
                        _ => break,
                    }
                }
            }
        }
        match page.cursor {
            Some(c) => cursor = Some(c),
            None => break,
        }
    }
    Ok(n)
}
