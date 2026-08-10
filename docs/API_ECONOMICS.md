# Figma API Economics

| Field | Value |
|-------|--------|
| **Status** | Research — architecture only |
| **Date** | 2026-07-18 |
| **Primary sources** | [Rate Limits](https://developers.figma.com/docs/rest-api/rate-limits/), [Help Center](https://help.figma.com/hc/en-us/articles/34963238552855-What-if-I-m-rate-limited), [File endpoints](https://developers.figma.com/docs/rest-api/file-endpoints/), [Errors](https://developers.figma.com/docs/rest-api/errors/) |
| **Effective** | Updated limits in effect since **2025-11-17** |

---

## 1. How limits are actually enforced

Figma applies REST rate limits using three dimensions simultaneously:

1. **Seat type** of the authenticated user (`View` / `Collab` vs `Dev` / `Full`)
2. **Endpoint tier** (1 / 2 / 3) — based on infrastructure cost of the endpoint
3. **Plan of the resource** (where the *file* lives), not only the user’s “best” seat elsewhere

Enforcement algorithm (official): **leaky bucket**. When the bucket is full, the API returns **HTTP 429**.

**Critical product implication:** a Full seat on Enterprise does **not** raise limits for a file that still lives on **Starter**. Move/copy the file into the paid workspace first ([Help Center](https://help.figma.com/hc/en-us/articles/34963238552855-What-if-I-m-rate-limited)).

---

## 2. Official limit tables

Rates are **per minute** unless noted as **/month**. Blank Starter Dev/Full cells are as published by Figma (no published Dev/Full per-minute rate for Starter); Starter *files* are constrained by the View/Collab Tier‑1 monthly cap in practice and by Help Center wording (“up to 6 per month” for Starter file content).

### Tier 1 — content & rendered images

Endpoints: `GET file`, `GET file nodes`, `GET image`

| Seat | Starter | Professional | Organization | Enterprise |
|------|---------|--------------|--------------|------------|
| View, Collab | **Up to 6/month** | Up to 6/month | Up to 6/month | Up to 6/month |
| Dev, Full | *(blank in official table)* | **10/min** | **15/min** | **20/min** |

### Tier 2 — fills, comments, variables read, discovery, …

Includes: `GET image fills`, comments, discovery, project listing, `GET local/published variables`, version history, webhooks, …

| Seat | Starter | Professional | Organization | Enterprise |
|------|---------|--------------|--------------|------------|
| View, Collab | Up to **5/min** | Up to 5/min | Up to 5/min | Up to 5/min |
| Dev, Full | *(blank)* | **25/min** | **50/min** | **100/min** |

### Tier 3 — metadata & analytics-class

Includes: activity logs, components & styles, `GET file metadata`, library analytics, payments, project metadata, users, `POST variables`, …

| Seat | Starter | Professional | Organization | Enterprise |
|------|---------|--------------|--------------|------------|
| View, Collab | Up to **10/min** | Up to 10/min | Up to 10/min | Up to 10/min |
| Dev, Full | *(blank)* | **50/min** | **100/min** | **150/min** |

**Note on View/Collab:** Figma states the actual monthly/minute cap **may be lower under high demand** (example: View seat might only get ~2 Tier‑1 file reads in a month).

---

## 3. Auth model → budget scope

| Credential | Tracking basis (official) | Shared how? |
|------------|---------------------------|-------------|
| **OAuth app** | **per-user, per-plan, per-app** | App A budget ≠ App B; User A ≠ User B |
| **Plan access token** | **per-token, per-plan** | Each token has its own budget |
| **Personal Access Token (PAT)** | **per-user, per-plan** (token owner) | All scripts/users sharing one PAT share **one** bucket |

PAT caveat (official): tokens are account-wide, but **enterprise-level rates only apply to files residing in that Enterprise plan**. Starter drafts still get Starter rates.

---

## 4. Are limits per file / workspace / user / token / app?

| Question | Answer (evidence) |
|----------|-------------------|
| Per file? | **No separate per-file quota documented.** Limits follow **resource plan + seat + auth scope**. Many Starter files under the same user/app still compete for the same Starter Tier‑1 monthly budget. |
| Per workspace? | **Indirectly** — the plan of the workspace/file determines which column of the table applies. |
| Per user? | **Yes** for OAuth and PAT (token owner). |
| Per token? | **Yes** for plan access tokens; **shared** for one PAT across many consumers. |
| Per app? | **Yes** for OAuth (per-user × per-plan × per-app). |

---

## 5. Response headers (429 only — documented)

| Header | Type | Meaning |
|--------|------|---------|
| `Retry-After` | integer seconds | Wait this long before retry |
| `X-Figma-Plan-Tier` | enum | `enterprise` \| `org` \| `pro` \| `starter` \| `student` — **plan of the resource** |
| `X-Figma-Rate-Limit-Type` | enum | `low` = View/Collab; `high` = Full/Dev |
| `X-Figma-Upgrade-Link` | URL | Pricing or settings deep-link to surface to users |

### Remaining quota on success?

**Not documented** on the official Rate Limits page. Do **not** depend on `X-RateLimit-Remaining` / `Limit` / `Reset` for product logic unless Figma documents them on that page. Estimate usage from **local counters** + observed 429s (see `BUDGET_MANAGER.md`).

### How `Retry-After` works

- Integer **seconds**.
- Short values (seconds–minutes) → typical per-minute leaky-bucket refill.
- Very large values (hours–days) → observed in the wild for Starter Tier‑1 monthly exhaustion (e.g. ~111h with `X-Figma-Plan-Tier: starter`). Treat as **hard lock** for that budget, not a “retry loop” opportunity.

### How `X-Figma-Plan-Tier` works

Tells you which **column** of the rate table applied to the *resource*. Use it to:

1. Explain failures to users (“this file is on Starter”)
2. Drive Product Modes (`PRODUCT_MODES.md`)
3. Recommend “duplicate file into paid team”

---

## 6. Hidden / secondary costs (challenge assumptions)

| Cost | Counts against Tier? | Notes |
|------|----------------------|-------|
| `api.figma.com` REST | **Yes** | Tier by endpoint |
| CDN download of export/fill URLs | **No** (not a Tier call) | Still bandwidth + time; URLs expire |
| OAuth token exchange | Separate | Not in Tier table |
| Retries after 429 | **Yes** if request is accepted into bucket again | Our `figmaGet` may retry short 429s up to 4 attempts |
| Webhooks / polling for freshness | Can burn Tier 2/3 | Prefer event-driven refresh |

**Image URL expiry (official file endpoints):**

- `GET image` (rendered) URLs: expire after **30 days**
- `GET image fills` URLs: expire after **≤ 14 days**

→ Production products **must download and re-host** (local/S3/CDN). Caching only the remote URL is a time bomb.

---

## 7. How rate limits affect large products

| Scale symptom | Mechanism | Mitigation theme |
|---------------|-----------|------------------|
| Starter demos die after a few Generate clicks | 6 Tier‑1 / month × 2–4 calls/MISS | Exact + subtree cache; never refresh casually |
| Team shares one PAT | One bucket for everyone | Prefer OAuth per user or plan tokens |
| Section-by-section convert | Exact-key MISS per `nodeId` | Parent/page/file snapshot + slice |
| Image-heavy pages | Extra Tier‑1 `GET image` | Prefer fills + content hash; batch ≤60 ids |
| Multi-tenant SaaS | Each customer OAuth budget independent | Still need shared artifact CDN for *outputs* |
| “We upgraded to Pro but still 429” | File still on Starter | Move file; check `X-Figma-Plan-Tier` |

---

## 8. Recommendation cards

### R1 — Treat resource plan as the unit of economics

| | |
|--|--|
| **Problem** | Users assume their seat upgrades all files |
| **Evidence** | Rate Limits + Help Center + Forum (Enterprise token × Starter file) |
| **Tradeoffs** | UX friction to explain “move the file” |
| **Expected API savings** | Unlocks Pro+ per-minute budgets (order-of-magnitude) |
| **Performance** | Unlocks parallel convert |
| **Complexity** | Low (docs + UI copy) |
| **Priority** | **P0** |

### R2 — Prefer OAuth over shared PAT for multi-user products

| | |
|--|--|
| **Problem** | Shared PAT collapses team into one budget |
| **Evidence** | Official PAT example (Mei’s script) |
| **Tradeoffs** | OAuth app review / scopes |
| **API savings** | Isolates abuse; enables per-user Budget Manager |
| **Complexity** | Medium |
| **Priority** | **P0** for SaaS; **P2** for solo CLI |

### R3 — Never busy-retry long `Retry-After`

| | |
|--|--|
| **Problem** | Retrying 111h locks wastes nothing but confuses UX |
| **Evidence** | Official retry guidance + our runtime |
| **Tradeoffs** | Need offline/cache path |
| **API savings** | Avoids useless attempts |
| **Complexity** | Low |
| **Priority** | **P0** |
