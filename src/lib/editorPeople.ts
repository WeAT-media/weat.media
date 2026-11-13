/**
 * Лёгкий реестр людей для @mention-автодополнения в BlockSuite-редакторе.
 * Отдельный модуль без React/BlockSuite-зависимостей: StoreProvider
 * наполняет его из articles/profiles, mention-контроллер читает синхронно.
 */
export interface EditorPerson {
  name: string
  handle: string
}

let people: EditorPerson[] = []

export function setEditorPeople(list: EditorPerson[]) {
  people = list
}

export function getEditorPeople(): EditorPerson[] {
  return people
}
