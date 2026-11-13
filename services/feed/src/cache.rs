//! Кэш ранжированных ответов в памяти сервиса. hot и best пересчитываются по всему окну индекса,
//! а смысл ответа за минуту почти не меняется — отдаём готовый JSON, пока он свежий.
//!
//! Цена: новый лайк поднимет статью в выдаче с задержкой до TTL (счётчик на самой статье — сразу).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// «Горячее» и «Лучшее»: новый лайк виден в порядке выдачи не позже чем через минуту
pub const RANKED_TTL: Duration = Duration::from_secs(60);
/// «Читать дальше»: похожие статьи почти не меняются
pub const RELATED_TTL: Duration = Duration::from_secs(30 * 60);
/// больше ключей не держим: при переполнении выбрасываем просроченные, не помогло — всё
const MAX_ENTRIES: usize = 2_000;

#[derive(Default)]
pub struct Cache {
    entries: Mutex<HashMap<String, (Instant, String)>>,
}

impl Cache {
    /// готовый JSON, если моложе ttl; now — параметром, чтобы проверять без ожидания
    pub fn get(&self, key: &str, ttl: Duration, now: Instant) -> Option<String> {
        let map = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        map.get(key)
            .filter(|(at, _)| now.duration_since(*at) < ttl)
            .map(|(_, body)| body.clone())
    }

    pub fn put(&self, key: String, body: String, ttl: Duration, now: Instant) {
        let mut map = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        if map.len() >= MAX_ENTRIES {
            map.retain(|_, (at, _)| now.duration_since(*at) < ttl);
            if map.len() >= MAX_ENTRIES {
                map.clear();
            }
        }
        map.insert(key, (now, body));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expires_after_ttl() {
        let c = Cache::default();
        let t0 = Instant::now();
        c.put("hot".into(), "[1]".into(), RANKED_TTL, t0);
        assert_eq!(
            c.get("hot", RANKED_TTL, t0 + Duration::from_secs(59))
                .as_deref(),
            Some("[1]")
        );
        assert_eq!(c.get("hot", RANKED_TTL, t0 + RANKED_TTL), None);
        assert_eq!(c.get("best", RANKED_TTL, t0), None);
    }

    #[test]
    fn bounded() {
        let c = Cache::default();
        let t0 = Instant::now();
        for i in 0..MAX_ENTRIES + 10 {
            c.put(format!("k{i}"), String::new(), RANKED_TTL, t0);
        }
        assert!(c.entries.lock().unwrap().len() <= MAX_ENTRIES);
    }
}
