# n8n-nodes-ceki

Custom n8n nodes for [ceki](https://browser.ceki.me) — rent **real human browsers** for AI automation. Anti-bot, captcha-by-human, geo-targeting, profile reuse.

Под капотом — [`@ceki/sdk`](https://browser.ceki.me/docs). Логика аренды / CDP / humanizer живёт в SDK, ноды — тонкие UI-фасады.

## Установить (в self-hosted n8n)

**Settings → Community Nodes → Install →** `n8n-nodes-ceki`

Или вручную:
```bash
npm install n8n-nodes-ceki
```

## Credential

Создать один раз: **Ceki API** → `token` = agent token (`ag_...`) из панели ceki. Используется всеми нодами.

## Ноды

### Browser Ceki (operation-based — одна нода, много операций)

Как Google Drive / S3: выбираешь Operation, нода показывает нужные поля. Operation `Rent`/`Run Code` сама арендует браузер; остальные берут `session_id` и resume'ят сессию.

| Operation | Что делает |
|---|---|
| **Rent** | Арендовать браузер (по Schedule ID или search по geo/price). Выводит `session_id`. Сессия остаётся в grace 120s → следующая нода resume. |
| **Navigate** | Открыть URL. |
| **Click / Type / Scroll** | Взаимодействие (координаты / текст / delta). |
| **Screenshot** | Скрин → binary (PNG/base64, опц. full-page). |
| **Snapshot** | Скрин + chat-история сессии. |
| **Wait** | Фиксированная пауза (ms). |
| **Wait for Selector** | Ждёт появления CSS-селектора в DOM (poll через CDP `Runtime.evaluate`, с timeout). |
| **Upload** | Загрузить файл (binary) в `<input>` по селектору. |
| **Close** | Закрыть сессию + остановить биллинг. |
| **Run Code** | Rent → arbitrary JS с `browser`/`client` в scope → close. Полный контроль (`requestCaptcha`, `paste`, raw CDP `browser.send(...)`). |

### Recipes (one-shot — минимум полей, один lifecycle)

| Нода | Что делает |
|---|---|
| **Browser Ceki: Screenshot in Geo** | Rent в geo → URL → screenshot → release. |
| **Browser Ceki: Captcha-protected Scrape** | Rent → navigate → (опц.) waitForSelector → `requestCaptcha` (капчу решает живой человек) → screenshot + HTML → release. Коронной юзкейс ceki: anti-bot-сайт проходит за счёт реального fingerprint. |

### Ceki Contract (operation-based — контракт-система ceki)

Нативная нода для tasks/events. Под капотом `ContractClient` из `@ceki/sdk` — заменяет HTTP Request templates типизированными полями. Та же credential `cekiApi`.

| Operation | Что делает |
|---|---|
| **List My Contracts** | Контракты, где я участник. |
| **List Tasks in Contract** | Events контракта (contract_id). |
| **Get Task** | Один event по event_id. |
| **My Assigned Events** | Задачи, назначенные на меня (`get-my-events`). |
| **Create Task** | Создать event: label, description, status, executor (benefitable `agent:N`/`user:N`). |
| **Assign Executor** | Назначить исполнителя на event (`propose({benefitable})`). |
| **Update Status** | Сменить статус event'а (100 Backlog · 200 Hand · 222 · 300 QA · 350 · 499). |
| **Comment** | Комментарий на event. |
| **Progress Report** | Status-correction + progress-коммент одним вызовом (не перезаписывает spec). |
| **Call Human** | Эскалация к человеку (`call-human`): input / review / stuck + сообщение. Возвращает recipients, dispatched, deep_link. |
| **Poll Notifications** | Дёрнуть `/agent/polling` (возвращает `[]` на 429 rate-limit). |

> Публикация постов на vc.ru/Mataroa/HackerNoon через human-браузер — см. template `publish-to-platform.json` в репо `ceki/n8n-templates` (использует Browser Ceki: Run Code с `paste()` реальным clipboard).

## Архитектура WS-lifecycle

`@ceki/sdk` держит WebSocket (Client → relay, Browser → CDP). n8n-нода stateless после `execute()`. Поэтому:

- **Operation chain**: `Rent` отдаёт `session_id` (disconnect без close → сессия в grace 120s), следующие операции `client.resume(sessionId)` → действие → disconnect. Работает для быстрых flow (узлы идут за миллисекунды).
- **Run Code / Recipes**: всё в одном `execute()` (rent → код/операции → close), один lifecycle, ноль resume-overhead.

## Пример flow

```
[Browser Ceki: Rent] →session_id→ [Browser Ceki: Screenshot] →session_id→ [Browser Ceki: Close]
                                                                        ↓
                                                                  [Telegram: sendPhoto]
```

## Разработка

```bash
npm install
npm run build      # tsc → dist/
npm run typecheck
```

Локально в n8n: слинковать `dist/` через `N8N_CUSTOM_EXTENSIONS` или `NODE_PATH`.

## License

MIT. Зависимость: `@ceki/sdk`.
