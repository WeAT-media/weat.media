//! Досмотры видео из analytics → articles.completes, раз в несколько минут.
//! Ранжирование читает только свою базу: analytics недоступен — порядок держится на прошлых числах.

use std::time::Duration;

use serde::Deserialize;
use sqlx::PgPool;

/// чаще не нужно: hot и так кэшируется на минуту, а досмотров за пять минут набегает немного
pub const SYNC_EVERY: Duration = Duration::from_secs(5 * 60);

#[derive(Deserialize)]
struct Item {
    /// id статьи на сайте: rkey-<хвост DID> (как remoteId во фронте) или AT URI
    id: String,
    completes: i64,
}

#[derive(Deserialize)]
struct Page {
    items: Vec<Item>,
}

/// id сайта → (rkey, хвост DID); для AT URI — (rkey, полный DID)
pub fn split_site_id(id: &str) -> Option<(String, String)> {
    if let Some(rest) = id.strip_prefix("at://") {
        let mut parts = rest.split('/');
        let did = parts.next()?;
        let _collection = parts.next()?;
        return Some((parts.next()?.to_string(), did.to_string()));
    }
    let (rkey, tail) = id.rsplit_once('-')?;
    (!rkey.is_empty() && tail.len() == 6).then(|| (rkey.to_string(), tail.to_string()))
}

pub async fn sync(pool: &PgPool, http: &reqwest::Client, base: &str) -> Result<usize, String> {
    let page: Page = http
        .get(format!(
            "{base}/analytics-api/completions?days={}",
            crate::rank::HOT_WINDOW_DAYS
        ))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let (mut rkeys, mut dids, mut ns) = (vec![], vec![], vec![]);
    for it in page.items {
        if let Some((rkey, did)) = split_site_id(&it.id) {
            rkeys.push(rkey);
            dids.push(did);
            ns.push(it.completes.clamp(0, i32::MAX as i64) as i32);
        }
    }
    // одним запросом: новые числа, а у выпавших из окна — ноль
    let updated = sqlx::query(
        "WITH x AS (SELECT * FROM UNNEST($1::text[], $2::text[], $3::int4[]) AS x(rkey, did, n)),
         hit AS (
           SELECT a.uri, max(x.n) AS n FROM articles a JOIN x ON a.rkey = x.rkey
             AND (a.did = x.did OR right(a.did, 6) = x.did)
           GROUP BY a.uri
         )
         UPDATE articles a SET completes = coalesce(hit.n, 0)
         FROM (SELECT uri FROM articles WHERE completes > 0 UNION SELECT uri FROM hit) t
         LEFT JOIN hit ON hit.uri = t.uri
         WHERE a.uri = t.uri AND a.completes IS DISTINCT FROM coalesce(hit.n, 0)",
    )
    .bind(&rkeys)
    .bind(&dids)
    .bind(&ns)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(updated.rows_affected() as usize)
}

pub async fn run(pool: PgPool, base: String) {
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap();
    loop {
        match sync(&pool, &http, &base).await {
            Ok(n) => tracing::info!(updated = n, "completions synced"),
            Err(err) => tracing::warn!(%err, "completions sync"),
        }
        tokio::time::sleep(SYNC_EVERY).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn site_ids() {
        assert_eq!(
            split_site_id("3n25edx2mac2w-ab7mgs"),
            Some(("3n25edx2mac2w".into(), "ab7mgs".into()))
        );
        assert_eq!(
            split_site_id("at://did:plc:abc/media.weat.article/3k"),
            Some(("3k".into(), "did:plc:abc".into()))
        );
        assert_eq!(
            split_site_id("u-1731"),
            None,
            "локальная запись — не из индекса"
        );
        assert_eq!(split_site_id("nodash"), None);
    }
}
