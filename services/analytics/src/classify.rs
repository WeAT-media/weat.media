//! Канал трафика по referrer и фильтр ботов.

use url::Url;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Source {
    pub channel: &'static str,
    pub name: String,
}

const SEARCH: &[&str] = &["google.", "yandex.", "ya.ru", "bing.com", "duckduckgo.com", "search.brave.com", "ecosia.org", "mail.ru", "yahoo."];
const SOCIAL: &[(&str, &str)] = &[
    ("t.me", "Telegram"),
    ("telegram.", "Telegram"),
    ("vk.com", "VK"),
    ("vk.ru", "VK"),
    ("bsky.app", "Bluesky"),
    ("x.com", "X"),
    ("twitter.com", "X"),
    ("t.co", "X"),
    ("facebook.com", "Facebook"),
    ("reddit.com", "Reddit"),
    ("linkedin.com", "LinkedIn"),
    ("habr.com", "Habr"),
    ("youtube.com", "YouTube"),
    ("ok.ru", "Одноклассники"),
    ("dzen.ru", "Дзен"),
];

fn host_matches(host: &str, pat: &str) -> bool {
    if pat.ends_with('.') {
        host.starts_with(pat) || host.contains(&format!(".{pat}"))
    } else {
        host == pat || host.ends_with(&format!(".{pat}"))
    }
}

/// own_hosts — домены площадки: переход изнутри считается лентой/навигацией
pub fn source(referrer: Option<&str>, own_hosts: &[String]) -> Source {
    let Some(host) = referrer
        .and_then(|r| Url::parse(r).ok())
        .and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_ascii_lowercase()))
    else {
        return Source { channel: "direct", name: String::new() };
    };
    if own_hosts.iter().any(|o| host == *o || host.ends_with(&format!(".{o}"))) {
        return Source { channel: "feed", name: String::new() };
    }
    // имя — совпавший шаблон, а не хост: google.attacker.xyz не попадёт в публичную статистику под своим именем
    if let Some(p) = SEARCH.iter().find(|p| host_matches(&host, p)) {
        return Source { channel: "search", name: p.trim_end_matches('.').to_string() };
    }
    if let Some((_, name)) = SOCIAL.iter().find(|(p, _)| host_matches(&host, p)) {
        return Source { channel: "social", name: (*name).to_string() };
    }
    Source { channel: "other", name: host }
}

pub fn is_bot(user_agent: &str) -> bool {
    let ua = user_agent.to_ascii_lowercase();
    ua.is_empty()
        || ["bot", "crawler", "spider", "slurp", "headless", "lighthouse", "preview", "curl/", "wget/", "python-requests", "go-http-client"]
            .iter()
            .any(|m| ua.contains(m))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn own() -> Vec<String> {
        vec!["weat.media".into()]
    }

    #[test]
    fn channels() {
        assert_eq!(source(None, &own()).channel, "direct");
        assert_eq!(source(Some("https://weat.media/feed"), &own()).channel, "feed");
        assert_eq!(source(Some("https://ru.weat.media/"), &own()).channel, "feed");
        assert_eq!(source(Some("https://www.google.com/search?q=x"), &own()).channel, "search");
        assert_eq!(source(Some("https://yandex.ru/search"), &own()).channel, "search");
        assert_eq!(source(Some("https://google.attacker.xyz/"), &own()).name, "google");
        let tg = source(Some("https://t.me/somechannel"), &own());
        assert_eq!((tg.channel, tg.name.as_str()), ("social", "Telegram"));
        // не путаем t.co с t.me и чужие домены с похожим суффиксом
        assert_eq!(source(Some("https://notx.com/"), &own()).channel, "other");
        assert_eq!(source(Some("garbage"), &own()).channel, "direct");
    }

    #[test]
    fn bots() {
        assert!(is_bot("Mozilla/5.0 (compatible; Googlebot/2.1)"));
        assert!(is_bot("curl/8.4"));
        assert!(is_bot(""));
        assert!(!is_bot("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Safari/605.1.15"));
    }
}
