//! weat-feed: индекс статей из потока событий PDS и быстрая выдача ленты.
//! При старте — догрузка существующих записей, затем подписка на subscribeRepos.

mod api;
mod backfill;
mod cache;
mod completions;
mod events;
mod firehose;
mod index;
mod rank;
mod record;
mod rss;
mod standard;

use std::net::SocketAddr;

use axum::http::{HeaderValue, Method};
use tower_http::cors::CorsLayer;

fn env(name: &str, default: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| default.to_string())
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let pds_url = env("PDS_URL", "http://localhost:2583")
        .trim_end_matches('/')
        .to_string();
    // поток событий: свой PDS; позже — relay сети (вся ATmosphere)
    let firehose_url = env("FIREHOSE_URL", &pds_url.replacen("http", "ws", 1));
    let port: u16 = env("PORT", "8790").parse().expect("PORT");
    let origins: Vec<HeaderValue> = env("CORS_ORIGIN", "http://localhost:3000")
        .split(',')
        .filter_map(|o| o.trim().parse().ok())
        .collect();

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await
        .expect("postgres");
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("migrations");

    let pds = backfill::Pds {
        base: pds_url,
        http: reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap(),
    };
    {
        let (pool, pds) = (pool.clone(), pds.clone());
        tokio::spawn(async move {
            match backfill::run(&pool, &pds).await {
                Ok(n) => tracing::info!(records = n, "backfill done"),
                Err(err) => tracing::error!(%err, "backfill"),
            }
        });
    }
    tokio::spawn(firehose::run(pool.clone(), pds.clone(), firehose_url));
    // PDS соседнего контура (PEER_PDS_URLS, через запятую): общая лента — статьи NL видны в RU и наоборот.
    // Свой backfill и своя позиция потока у каждого; закрытое в контуре отсекает AppView (restricted).
    for base in env("PEER_PDS_URLS", "")
        .split(',')
        .map(|u| u.trim().trim_end_matches('/'))
        .filter(|u| u.starts_with("https://"))
    {
        let peer = backfill::Pds {
            base: base.to_string(),
            http: pds.http.clone(),
        };
        let ws = base.replacen("https", "wss", 1);
        {
            let (pool, peer) = (pool.clone(), peer.clone());
            tokio::spawn(async move {
                match backfill::run(&pool, &peer).await {
                    Ok(n) => tracing::info!(records = n, pds = %peer.base, "peer backfill done"),
                    Err(err) => tracing::error!(%err, pds = %peer.base, "peer backfill"),
                }
            });
        }
        tokio::spawn(firehose::run(pool.clone(), peer, ws));
    }
    // документы standard.site из всей сети — только авторы из белого списка (standard_allow)
    tokio::spawn(standard::run(
        pool.clone(),
        standard::Resolver::new(env("PLC_URL", "https://plc.directory")),
        env("JETSTREAM_URL", "wss://jetstream2.us-east.bsky.network"),
    ));
    // досмотры видео для ранжирования; без ANALYTICS_URL видео ранжируются по лайкам и комментариям
    if let Ok(url) = std::env::var("ANALYTICS_URL") {
        tokio::spawn(completions::run(
            pool.clone(),
            url.trim_end_matches('/').to_string(),
        ));
    }

    let state = api::AppState {
        pool,
        site_url: env("SITE_URL", "http://localhost:3000")
            .trim_end_matches('/')
            .to_string(),
        site_name: env("SITE_NAME", "weAT.media"),
        cache: Default::default(),
        admin_token: std::env::var("FEED_ADMIN_TOKEN").ok(),
    };
    let app = api::router(state).layer(
        CorsLayer::new()
            .allow_origin(origins)
            .allow_methods([Method::GET]),
    );
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port)))
        .await
        .expect("bind");
    tracing::info!(port, "feed listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .expect("serve");
}
