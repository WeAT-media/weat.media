//! Лимит событий на IP (фиксированное окно), независимо от User-Agent.
//! Память ограничена: при переполнении чистим старые окна, иначе отказ.

use std::collections::HashMap;
use std::hash::{BuildHasher, RandomState};
use std::net::IpAddr;
use std::time::{Duration, Instant};

pub struct RateLimit {
    window: Duration,
    max: u32,
    cap: usize,
    hasher: RandomState,
    hits: HashMap<u64, (Instant, u32)>,
}

impl RateLimit {
    pub fn new(window: Duration, max: u32, cap: usize) -> Self {
        Self { window, max, cap, hasher: RandomState::new(), hits: HashMap::new() }
    }

    /// IPv6 считаем по /64: у клиента обычно целая подсеть
    fn key(&self, ip: &str) -> u64 {
        match ip.parse::<IpAddr>() {
            Ok(IpAddr::V6(v6)) if v6.to_ipv4_mapped().is_none() => self.hasher.hash_one(u128::from(v6) >> 64),
            Ok(IpAddr::V6(v6)) => self.hasher.hash_one(v6.to_ipv4_mapped().map(u32::from)),
            Ok(IpAddr::V4(v4)) => self.hasher.hash_one(Some(u32::from(v4))),
            Err(_) => self.hasher.hash_one(ip),
        }
    }

    pub fn allow(&mut self, ip: &str, now: Instant) -> bool {
        let k = self.key(ip);
        if !self.hits.contains_key(&k) && self.hits.len() >= self.cap {
            self.prune(now);
            if self.hits.len() >= self.cap {
                return false;
            }
        }
        let e = self.hits.entry(k).or_insert((now, 0));
        if now.duration_since(e.0) >= self.window {
            *e = (now, 0);
        }
        e.1 += 1;
        e.1 <= self.max
    }

    pub fn prune(&mut self, now: Instant) {
        let w = self.window;
        self.hits.retain(|_, (t, _)| now.duration_since(*t) < w);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_per_ip() {
        let mut r = RateLimit::new(Duration::from_secs(60), 2, 100);
        let t = Instant::now();
        assert!(r.allow("1.1.1.1", t));
        assert!(r.allow("1.1.1.1", t));
        assert!(!r.allow("1.1.1.1", t), "третье в окне — отказ");
        assert!(r.allow("2.2.2.2", t), "другой IP");
        assert!(r.allow("1.1.1.1", t + Duration::from_secs(61)), "новое окно");
    }

    #[test]
    fn ipv6_by_64() {
        let mut r = RateLimit::new(Duration::from_secs(60), 1, 100);
        let t = Instant::now();
        assert!(r.allow("2001:db8::1", t));
        assert!(!r.allow("2001:db8::2", t), "та же /64");
    }

    #[test]
    fn bounded_memory() {
        let mut r = RateLimit::new(Duration::from_secs(60), 10, 2);
        let t = Instant::now();
        assert!(r.allow("1.1.1.1", t));
        assert!(r.allow("2.2.2.2", t));
        assert!(!r.allow("3.3.3.3", t), "таблица полна");
        assert!(r.allow("3.3.3.3", t + Duration::from_secs(61)));
        assert!(r.hits.len() <= 2);
    }
}
