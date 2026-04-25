---
name: project--prd
description: Product requirements for <project name>.
kind: conceptual
---

## 1 Objective and Background

Operators monitoring deployed agents currently have no single place to see episode health. Metrics are spread across raw log files and ad-hoc queries, so diagnosing a failing episode takes 8–15 minutes of manual stitching. This is now blocking the team as agent volume crosses 50 concurrent runs.

## 2 Users and Scenarios

**Users:** operators responsible for monitoring and triaging live agent episodes.

**Scenarios:**
- An episode fails mid-run; the operator needs to identify the failing step and the error within two minutes.
- At the start of a shift, the operator does a quick health sweep across all active episodes to spot anomalies before users report them.

## 3 Requirement

**Must do:**
- Display a live list of active episodes with status (running / failed / done) and elapsed time.
- For each episode, show a step-by-step timeline with per-step status and error message if applicable.
- Allow filtering by status and by agent type.
- Refresh automatically; no manual page reload required.

**Does not do:**
- No editing or replaying episodes from the UI.
- No user-facing (non-operator) access or authentication layer.
- No alerting or notification system.
- No historical trend charts or aggregated analytics.
- No support for non-episode task types.

## 4 Criteria

- An operator can open a failed episode and see the failing step and its error message in under 30 seconds.
- The episode list updates within 5 seconds of a status change without a page reload.
- Filtering by status returns correct results across a live dataset of ≥ 100 episodes.
- Scenario 1 and Scenario 2 above can be completed end-to-end in a usability walkthrough without the operator leaving the dashboard.
