//! weat-feed: индекс статей из потока событий PDS и быстрая выдача ленты.
//! При старте — догрузка существующих записей, затем подписка на subscribeRepos.

mod api;
mod backfill;
mod firehose;
mod index;
mod rank;
mod record;
mod rss;

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
    tokio::spawn(firehose::run(pool.clone(), pds, firehose_url));

    let state = api::AppState {
        pool,
        site_url: env("SITE_URL", "http://localhost:3000")
            .trim_end_matches('/')
            .to_string(),
        site_name: env("SITE_NAME", "weAT.media"),
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
