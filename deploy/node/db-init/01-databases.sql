-- Свой Postgres узла (профиль selfhosted-db): кроме основной базы AppView (indie, POSTGRES_DB),
-- лента и аналитика живут в своих базах. Выполняется один раз — при создании тома pg-data.
CREATE DATABASE feed OWNER indie;
CREATE DATABASE analytics OWNER indie;
CREATE DATABASE labeler OWNER indie;
