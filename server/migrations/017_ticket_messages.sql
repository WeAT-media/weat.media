-- Переписка в обращении. Ответ сотрудника доходит до заявителя на площадке, только если обращение
-- отправлено из вошедшего аккаунта (support_tickets.did): handle, вписанный гостем, не подтверждён —
-- иначе чужой ответ (с деталями заявителя) ушёл бы владельцу этого handle.
CREATE TABLE IF NOT EXISTS ticket_messages (
  id          TEXT PRIMARY KEY,                       -- tm_<random>
  ticket_id   TEXT NOT NULL REFERENCES support_tickets (id) ON DELETE CASCADE,
  author      TEXT NOT NULL CHECK (author IN ('staff', 'user')),
  staff_sub   TEXT,                                   -- кто из сотрудников (для аудита)
  text        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_messages_ticket_idx ON ticket_messages (ticket_id, created_at);

-- когда заявитель последний раз открыл обращение: новые ответы сотрудника — позже
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS user_seen_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS support_tickets_did_idx ON support_tickets (did, created_at DESC) WHERE did IS NOT NULL;
