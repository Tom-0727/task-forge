---
name: project--implementation-plan
description: Implementation plan for <project name>.
kind: conceptual
---

## 模块设计

| Module | Responsibility |
|---|---|
| episode_poller | Polls the harness API every 3 s and writes episode state to a local cache file |
| api_server | Thin FastAPI layer exposing `/episodes` and `/episodes/{id}` to the frontend |
| dashboard_ui | Single-page React app; renders episode list, timeline, and filter controls |

## 执行计划

1. Implement `episode_poller` — connect to harness API, verify data shape matches PRD requirements, write cache.
2. Implement `api_server` — serve cached data; add status and agent-type filter params.
3. Implement `dashboard_ui` — episode list view with live refresh; wire to api_server.
4. Implement episode detail view — step timeline and error display; end-to-end test against a real failed episode.
