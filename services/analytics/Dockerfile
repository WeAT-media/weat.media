FROM rust:1-slim AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src src
COPY migrations migrations
RUN cargo build --release --locked

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /src/target/release/weat-analytics /weat-analytics
ENV PORT=8789
EXPOSE 8789
ENTRYPOINT ["/weat-analytics"]
