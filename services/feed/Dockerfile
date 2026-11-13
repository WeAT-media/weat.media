FROM rust:1-slim AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src src
COPY migrations migrations
RUN cargo build --release --locked

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /src/target/release/weat-feed /weat-feed
ENV PORT=8790
EXPOSE 8790
ENTRYPOINT ["/weat-feed"]
