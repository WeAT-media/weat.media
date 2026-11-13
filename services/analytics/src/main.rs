//! weat-analytics: открытая аналитика статей.
//! Горячий путь (beacon) не трогает БД: события сворачиваются в памяти и пишутся пакетами.

mod api;
mod classify;
mod ingest;
mod ratelimit;

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::http::{HeaderValue, Method};
use tower_http::cors::CorsLayer;
use tower_http::limit::RequestBodyLimitLayer;

fn env(name: &str, default: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| default.to_string())
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into())).init();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let secret = std::env::var("VISITOR_SECRET").expect("VISITOR_SECRET: openssl rand -hex 32");
    assert!(secret.len() >= 32, "VISITOR_SECRET: минимум 32 символа");
    let port: u16 = env("PORT", "8789").parse().expect("PORT");
    let own_hosts: Vec<String> = env("OWN_HOSTS", "weat.media,localhost,127.0.0.1").split(',').map(|h| h.trim().to_ascii_lowercase()).filter(|h| !h.is_empty()).collect();
    let origins: Vec<HeaderValue> = env("CORS_ORIGIN", "http://localhost:3000").split(',').filter_map(|o| o.trim().parse().ok()).collect();

    let pool = sqlx::postgres::PgPoolOptions::new().max_connections(8).connect(&database_url).await.expect("postgres");
    sqlx::migrate!("./migrations").run(&pool).await.expect("migrations");

    let (tx, rx) = tokio::sync::mpsc::channel(env("QUEUE_SIZE", "50000").parse().expect("QUEUE_SIZE"));
    let writer = tokio::spawn(ingest::run_writer(pool.clone(), rx, Duration::from_millis(env("FLUSH_MS", "1000").parse().expect("FLUSH_MS")), 5_000));

    let state = Arc::new(api::AppState {
        pool: pool.clone(),
        tx,
        secret: secret.into_bytes(),
        own_hosts,
        trust_proxy: env("TRUST_PROXY", "false") == "true",
        views: Mutex::new(ingest::Dedupe::new(Duration::from_secs(30 * 60))),
        reads: Mutex::new(ingest::Dedupe::new(Duration::from_secs(24 * 3600))),
        times: Mutex::new(ingest::Dedupe::new(Duration::from_secs(30 * 60))),
        plays: Mutex::new(ingest::Dedupe::new(Duration::from_secs(30 * 60))),
        completes: Mutex::new(ingest::Dedupe::new(Duration::from_secs(24 * 3600))),
        // 60 событий в минуту на IP; не больше 200k IP в таблице
        limit: Mutex::new(ratelimit::RateLimit::new(Duration::from_secs(60), 60, 200_000)),
    });

    // раз в 10 минут: окна дедупликации и вчерашние хеши посетителей
    let pruner = {
        let s = state.clone();
        tokio::spawn(async move {
            let mut t = tokio::time::interval(Duration::from_secs(600));
            loop {
                t.tick().await;
                let now = std::time::Instant::now();
                api::lock(&s.views).prune(now);
                api::lock(&s.reads).prune(now);
                api::lock(&s.times).prune(now);
                api::lock(&s.limit).prune(now);
                if let Err(err) = ingest::prune_visitors(&s.pool, chrono::Utc::now().date_naive()).await {
                    tracing::warn!(%err, "prune visitors");
                }
            }
        })
    };

    let app = api::router(state)
        .layer(RequestBodyLimitLayer::new(4 * 1024))
        .layer(CorsLayer::new().allow_origin(origins).allow_methods([Method::GET, Method::POST]).allow_headers([axum::http::header::CONTENT_TYPE]));

    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port))).await.expect("bind");
    tracing::info!(port, "analytics listening");
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .expect("serve");
    // последняя копия state (с отправителем очереди) — в pruner; без неё очередь закрывается
    // и писатель сбрасывает остаток пакета
    pruner.abort();
    let _ = pruner.await;
    let _ = writer.await;
}
