// Тема до первой отрисовки — без белой вспышки в тёмной теме. Отдельный файл: CSP запрещает встроенные скрипты.
// Гость — всегда как в системе; вошедший — его выбор (Настройки → Внешний вид → Тема), он же в localStorage.
;(function () {
  var pref = 'system'
  try {
    var s = JSON.parse(localStorage.getItem('indie-media:v1') || 'null')
    if (s && s.user && s.prefs && s.prefs.appearanceSet && s.prefs.appearance) pref = s.prefs.appearance
  } catch (e) {}
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  var root = document.documentElement
  root.classList.toggle('dark', dark)
  root.dataset.theme = dark ? 'dark' : 'light'
  root.style.colorScheme = dark ? 'dark' : 'light'
})()
