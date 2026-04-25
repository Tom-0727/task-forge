---
name: project--assumptions
description: Load-bearing assumptions for <project name> and their verification status.
kind: conceptual
---

## Assumptions

| # | Assumption | Status | Notes |
|---|---|---|---|
| A1 | Feishu webhook endpoint is reachable and accepts POST | verified | 200 on test ping |
| A2 | Bot token has permission to read group messages | verified | returned 10 msgs in target group |
| A3 | Message volume < 500/day, within free-tier rate limit | unverified | need to check quota |
| A4 | Historical data export API exists and returns > 30 days | failed | max 7 days per docs and probe |

## Detail

**A1** — `curl -X POST https://open.feishu.cn/open-apis/bot/v2/hook/<token> -d '{"msg_type":"text","content":{"text":"ping"}}'` → 200 `{"code":0}`

**A2** — called `GET /open-apis/im/v1/messages?container_id=<group_id>&limit=10` with bot token → returned 10 message objects with full content fields

**A3** — not yet probed; need to call `/open-apis/application/v6/app_usage/message_pushed_overview` to get actual volume

**A4** — docs state max range is 7 days; confirmed by probe: requested 30-day range, API returned `{"code":230001,"msg":"date range exceeds limit of 7 days"}`
