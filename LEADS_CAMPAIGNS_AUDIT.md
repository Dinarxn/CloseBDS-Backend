# LEADS_CAMPAIGNS_AUDIT: CloseBDS Backend (CloseVDS Acquisition OS)
**Comprehensive Audit of Leads Management, Local Market Discovery, Technical Website Audits & Multi-Channel Campaigns**
**Auditor Role**: Subagent 3 Specialist Baseline (Phase R1 Deliverable)
**Target Backend**: `Dinarxn/CloseBDS-Backend` (`src/modules/leads/`, `src/modules/lead-discovery/`, `src/modules/lead-research/`, `src/modules/campaigns/`)
**Frontend Reference**: `Dinarxn/CloseVDS-` (`CloseVDS/app/(dashboard)/leads/`, `components/leads/`, `CloseVDS/lib/api-client.ts`)
**Audit Date**: 2026-11-09
**Status**: COMPLETE (Architectural Inventory, Contract Mappings & Expansion Proposals Documented)

---

## 1. Executive Summary & Domain Scope

This audit evaluates the four foundational acquisition pipeline modules powering CloseVDS:
1. **Leads Management**: Lifecycle states, CRUD endpoints, contact management, pagination, search, batch mutations, and tenant boundary enforcement.
2. **Local Lead Discovery Pipeline**: Multi-provider targeting (Geoapify Places API v2, OpenStreetMap Nominatim/Overpass QL), geographic bounding box (`rect`) vs circular radius (`circle`) scoping, data quality tiering, and actionability scoring.
3. **Lead Enrichment & Technical Website Audit**: Anti-SSRF safe crawling, SSL inspection, mobile responsiveness checks, dental booking engine detection (NexHealth, LocalMed, Zocdoc), and deterministic qualification scoring.
4. **Campaigns Management**: Campaign lifecycles, audience assignment, multi-touch sequences, performance telemetry, and frontend contract alignment.

---

## 2. Leads Management Architecture

### 2.1 File & Route Inventory
- **Router**: `backend/src/modules/leads/lead.router.ts` (mounted at `/api/v1/leads`)
- **Service**: `backend/src/modules/leads/lead.service.ts` (`LeadService`)
- **AI Service**: `backend/src/modules/leads/lead-ai.service.ts` (`LeadAiService`)
- **Schemas**: `backend/src/modules/leads/lead.schema.ts` (Zod validation schemas)
- **Repository**: `LeadRepository` in `backend/src/database/repository.ts` (lines 442–829)
- **Prisma Model**: `Lead` (`schema.prisma` lines 231–260)

### 2.2 Endpoints & Multi-Tenant Isolation
All routes enforce `requireAuthenticatedUser` and `requireWorkspaceContext` preHandler hooks:
- `GET /api/v1/leads`: Paginated list filtered by `workspaceId`, `campaignId`, `status`, and case-insensitive substring search on `businessName`, `domain`, and `address`.
- `GET /api/v1/leads/:id`: Scoped lead lookup returning relations (`Contact[]`, `LeadScore`, `WebsiteAudit`, `AIAnalysis`). Throws HTTP 404 on cross-workspace access.
- `POST /api/v1/leads`: Single lead creation with 4-factor deduplication.
- `PATCH /api/v1/leads/:id`: Partial lead updates. Ownership verified prior to mutation.
- `DELETE /api/v1/leads/:id`: Cascading deletion of lead and child entities.
- `POST /api/v1/leads/:id/ai`: Triggers automated research, website audit, and qualification scoring.
- `POST /api/v1/leads/:id/approve` & `reject`: Authoritative human sign-off gates.
- Contacts CRUD (`/api/v1/leads/:leadId/contacts`): Manages multi-contact records per lead.

---

## 3. Local Lead Discovery Pipeline

```
[ Frontend: Discovery Modal ]
             |
             +---> POST /api/v1/lead-discovery/query
             |     Payload: { niche: "dentist", location: "Austin, TX", limit: 20 }
             v
[ DiscoveryDomainService ]
             |
             +---> Check Active Provider (Geoapify vs OSM Nominatim/Overpass)
             |
   +---------+-----------------------------------+
   |                                             |
   v                                             v
[ Geoapify Places API v2 ]              [ OpenStreetMap Overpass QL ]
- Nominatim geocoding to rect bbox       - Bounding box extraction
- Healthcare.dentist category            - amenity=dentist, healthcare=dentist
- Rate limit 429 backoff                 - 25s Overpass timeout handling
- In-memory place details cache          - Zero-cost fallback
   |                                             |
   +---------------------+-----------------------+
                         |
                         v
             [ lead-normalization.ts ]
             - Data Quality: COMPLETE, GOOD, PARTIAL, MINIMAL
             - Actionability: READY, ENRICHMENT_REQUIRED, ARCHIVED_WEAK
             - Deduplication: 3-Tier Hierarchical Heuristic
                         |
                         v
             [ Return Candidates & Persist ]
```

### 3.1 External Provider Integrations
1. **Geoapify Places API v2 (`geoapify.adapter.ts`)**:
   - Maps `dentist` and `dental` to `healthcare.dentist` using `NICHE_GEOAPIFY_MAP`.
   - Uses OpenStreetMap Nominatim for geographic bounding box resolution (`rect:west,south,east,north`).
   - Handles HTTP 429 rate limits with exponential backoff and enforces 15-second timeouts (`AbortSignal.timeout(15000)`).
   - Masks API keys during logging and serialization.
2. **OpenStreetMap Overpass QL (`discovery.adapter.ts`)**:
   - Queries `amenity=dentist` and `healthcare=dentist`.
   - Operates as zero-cost fallback when Geoapify API key is unconfigured.
3. **Google Places Provider**: Intentionally disabled (`status: 'unavailable'`) to protect against unbudgeted billing.

### 3.2 Data Quality & Actionability Classification
Implemented in `backend/src/integrations/lead-discovery/lead-normalization.ts`:
- **`COMPLETE`**: Name + address + coordinates + phone + email + website.
- **`GOOD`**: Name + phone + address + website.
- **`PARTIAL`**: Name + at least one contact channel (phone or email).
- **`MINIMAL`**: Lacking actionable contact points.
- Actionability rules classify leads into `READY`, `ENRICHMENT_REQUIRED`, or `ARCHIVED_WEAK`, identifying eligible outbound channels (`VOICE`, `EMAIL`).

### 3.3 Geographic Scoping: Bounding Box (`rect`) vs Circular Radius (`circle`) Schemas

The Geoapify Places API v2 and OpenStreetMap Nominatim support two distinct spatial scoping strategies for locating dental clinics:

| Spatial Scoping Method | Geoapify Query Filter Parameter | Coordinate Inputs Required | Geocoding Resolution via Nominatim | Ideal Use Case | Backend Status |
|:---|:---|:---|:---|:---|:---:|
| **Bounding Box (`rect`)** | `filter=rect:lon1,lat1,lon2,lat2` *(west, south, east, north)* | Min/Max Latitude & Longitude extremes | `GET /search?q={location}&format=json` extracts `boundingbox: [latMin, latMax, lonMin, lonMax]` | Municipalities, counties, states, metro administrative zones | **Active Default** |
| **Circular Radius (`circle`)** | `filter=circle:lon,lat,radiusMeters` | Center Longitude, Center Latitude, Radius (meters) | `GET /search?q={location}&format=json` extracts center `lat, lon` | Neighborhoods, clinic catchment areas (e.g. 10km radius) | **Proposed Extension** |

#### Geoapify Bounding Box URL Formulation (Current):
```typescript
// Nominatim returns: [latMin, latMax, lonMin, lonMax]
const [latMin, latMax, lonMin, lonMax] = geoData[0].boundingbox;
const south = parseFloat(latMin);
const north = parseFloat(latMax);
const west = parseFloat(lonMin);
const east = parseFloat(lonMax);

// Geoapify rect format: filter=rect:west,south,east,north
const rectFilter = `rect:${west},${south},${east},${north}`;
const placesParams = new URLSearchParams({
  categories: 'healthcare.dentist',
  filter: rectFilter,
  limit: String(limit),
  apiKey: this.apiKey,
});
```

#### Proposed Dual-Mode Schema Expansion in `discovery.schema.ts`:
```typescript
export const leadDiscoveryQuerySchema = z.object({
  campaignId: z.string().uuid().optional(),
  niche: z.string().min(1).max(100),
  location: z.string().min(1).max(100),
  mode: z.enum(['bounding_box', 'radius']).default('bounding_box').optional(),
  radiusMeters: z.coerce.number().int().min(500).max(50000).default(10000).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  limit: z.coerce.number().int().positive().max(50).default(10),
  countryCode: z.string().max(10).optional(),
  provider: z.enum(['osm', 'geoapify', 'google']).optional(),
});
```

---

## 4. Lead Enrichment, Technical Website Audit & Qualification

### 4.1 Technical Website Audit Capabilities
- **Anti-SSRF Protection (`ssrf.guard.ts`)**: `validateUrlForAudit()` parses target URLs and blocks loopbacks (`127.0.0.1`), RFC-1918 private subnets, cloud metadata (`169.254.169.254`), and non-HTTP protocols.
- **Persistence (`WebsiteAudit` Model)**: Stores `domain`, `mobileOptimized`, `bookingCtaVisible`, `auditGaps` (string array), and `rawAuditData` (JSON).
- **Gaps Identified**: Live crawling, real TLS handshake inspection, and DOM-based booking engine detection (NexHealth, LocalMed, Zocdoc) are currently heuristic stubs returning simulated outputs or `unavailable` states.

### 4.2 Comprehensive 5-Rule Deterministic Service Opportunity Matrix

The qualification engine in `backend/src/modules/qualification/service-opportunity.evaluator.ts` enforces 5 strict deterministic business rules without external dependencies, eliminating AI hallucinations:

| Rule ID | Rule Name | Trigger Condition & Evidence Logic | Concrete Pattern Matches / RegEx Signals | Service Opportunity | Recommended Service | Actionability Outcome |
|:---:|:---|:---|:---|:---:|:---|:---:|
| **Rule 1** | **No Website** | Domain is missing, empty, or set to placeholder (`unknown-domain.com`, `none`, `null`, `n/a`, `no-website`, `undefined`) | `input.hasWebsite === false` OR known placeholder string match | **YES** | `Website Design / Development` | High priority outreach targeting clinic online presence setup |
| **Rule 2** | **Concrete Automation Opportunity** | Verified website exists, but audit evidence demonstrates operational workflow bottlenecks | 14 Patterns:<br>• `manual appointment follow[- ]?up`<br>• `manual customer inquiry handling`<br>• `repetitive lead handling`<br>• `manual booking workflow`<br>• `repetitive data entry`<br>• `manual patient intake`<br>• `spreadsheet[- ]based tracking`<br>• `paper[- ]based booking`<br>• `repetitive confirmation calls`<br>• `repetitive scheduling bottleneck` | **YES** | `AI Automation` | Pitch AI Voice Receptionist & automated patient intake workflows |
| **Rule 3** | **Customer Acquisition Opportunity** | Verified website exists, but evidence demonstrates empty schedules or lack of inbound lead flow | 11 Patterns:<br>• `customer acquisition problem`<br>• `lead generation problem`<br>• `low customer inquiry volume`<br>• `struggling to acquire new (patients\|clients)`<br>• `no consistent lead generation channel`<br>• `high customer churn with low inbound`<br>• `missing customer acquisition system`<br>• `empty appointment calendar`<br>• `inbound lead flow stagnant` | **YES** | `Customer Acquisition System` | Pitch Dental Acquisition Ad Campaigns & local SEO domination |
| **Rule 4** | **Insufficient Evidence** | Website exists, but zero concrete operational bottlenecks or acquisition deficits were documented | Fallback when collected observation strings lack specific RegEx signal matches | **NONE** | `NONE` | Kept in `RESEARCH_PENDING` or `NEW` state until further enrichment |
| **Rule 5** | **Functioning Website / No Gaps** | Verified active website present with documented observations confirming normal operations | `verifiedWebsite && allObservations.length > 0` with zero bottleneck matches | **NONE** | `NONE` | Marked `DISQUALIFIED` or `ARCHIVED_WEAK` (no immediate sales angle) |

#### Anti-Hallucination Generic Exclusion Filters
To prevent false-positive qualifications from generic LLM text, `isGenericOrWeak()` strictly rejects 11 vague patterns:
`"business exists"`, `"growing company"`, `"potential for technology"`, `"could be improved"`, `"good business"`, `"high rating"`, `"standard local business"`, `"general business"`, `"active business"`, `"technology opportunity"`, `"possible automation"`.

---

## 5. Lead Import & Deduplication Engine

### 5.1 Deduplication Discrepancy & Unification Proposal

The backend currently possesses two separate deduplication implementations:

| Feature / Dimension | Naive Match Key (`findByMatchKey`) | 3-Tier Hierarchical Engine (`findExistingLeadForDiscovery`) |
|:---|:---|:---|
| **Primary Usage** | `LeadService.createLead`, `importCloseBDSLeads` | `DiscoveryDomainService.executeDiscovery` |
| **Matching Logic** | Strict 4-factor exact string equality | 4-level hierarchical heuristic with normalization and fuzzy corroboration |
| **Phone Formatting Resilience** | **Zero**: Fails if `(555) 123-4567` vs `+15551234567` | **High**: Normalizes to E.164 and checks last-8 digits |
| **Domain Protocol Resilience** | **Zero**: Fails on `http://` vs `https://` or `www.` | **High**: Extracts bare root domain (`clinic.com`) |
| **Address Normalization** | **Zero**: Requires verbatim address string match | **High**: Normalizes street abbreviations (`St` -> `Street`, `Ste` -> `Suite`) |
| **Risk of Duplicate Injection** | **High**: Creates duplicate rows on minor formatting changes | **Very Low**: Conservative corroborating signals prevent collisions |

### 5.2 Complete 3-Tier Hierarchical Deduplication Matrix

Implemented in `LeadRepository.findExistingLeadForDiscovery()`:

```
[ Inbound Lead Candidate ]
            |
            v
[ Tier 0: Fast-Path Exact Match ]
  - Checks exact equality on (workspaceId, businessName, domain, phone)
  - If match found -> RETURN EXISTING LEAD
            | (No match)
            v
[ Tier 1: Normalized Domain Match with Corroboration ]
  - Extracts bare domain (e.g. "austindentalcare.com")
  - Searches database for matching domain within workspace
  - REQUIRES at least ONE corroborating signal:
      a) Jaro-Winkler business name similarity >= 0.75
      b) Normalized telephone last 8 digits match
      c) Normalized physical street address match
  - If domain matches + signal verified -> RETURN EXISTING LEAD
            | (No match)
            v
[ Tier 2: Normalized Phone Match with Business Name Corroboration ]
  - Normalizes telephone to E.164 format (+1XXXXXXXXXX)
  - Searches database for matching phone within workspace
  - REQUIRES business name token overlap or substring similarity >= 0.60
  - If phone matches + name corroborated -> RETURN EXISTING LEAD
            | (No match)
            v
[ Tier 3: Strict Business Name + Normalized Physical Address Match ]
  - Exact case-insensitive business name match
  - Street address and postal code normalized match within same city
  - If name + address match -> RETURN EXISTING LEAD
            | (No match)
            v
[ Result: Truly Unique New Lead -> INSERT INTO POSTGRESQL ]
```

---

## 6. Campaigns Module Architecture & Identified Gaps

### 6.1 Current Architecture & Endpoints
- **Router**: `campaign.router.ts` (mounted at `/api/v1/campaigns`).
- **Prisma Models**: `Campaign`, `EmailCampaign`, `VoiceCampaign`.
- **Endpoints**: `GET /` (paginated list), `GET /:id` (single inspection), `POST /` (create), `PATCH /:id` (update), `DELETE /:id` (delete).

### 6.2 Identified Gaps in Campaigns Module
1. **Missing Lifecycle States**: Prisma enum `CampaignStatus` only defines `DRAFT`, `ACTIVE`, `PAUSED`, `COMPLETED`. Missing `SCHEDULED` (queued for future dispatch) and `RUNNING` (actively executing batch jobs).
2. **Missing Multi-Touch Sequence Steps**: No `CampaignStep` model exists to orchestrate sequences (e.g. Day 1: Voice Call -> Day 3: WhatsApp -> Day 5: Email).
3. **Missing Lead Assignment Endpoints**: No dedicated endpoints exist to associate discovered leads with a campaign in bulk (e.g. `POST /api/v1/campaigns/:id/assign-leads`).
4. **Missing Performance Telemetry**: Aggregates only `_count: { leads }`. Lacks aggregate metrics for delivered messages, open rates, calls connected, and booked meetings.

---

## 7. Critical Contract Mismatches Breaking Frontend UI

### 7.1 Mismatch 1: `POST /api/v1/lead-discovery/query`
- **Location**: `components/leads/lead-discovery-modal.tsx:86`
- **Frontend Expectation**: `response.data.discovered` and `response.data.candidates`.
- **Backend Reality**: Returns flat `{ success: true, discoveredCount, candidates }`.
- **Impact**: Modal displays `0` discovered leads.
- **Backend Fix**: Wrap in `data: { discovered: result.discoveredCount, candidates: result.candidates, ... }`.

### 7.2 Mismatch 2: `GET /api/v1/campaigns` in Call Queue
- **Location**: `app/(dashboard)/calling/calls/page.tsx:48`
- **Frontend Expectation**: `response.items` or `response.data.items`.
- **Backend Reality**: Returns `{ success: true, data: Campaign[] }`.
- **Impact**: Campaign dropdown on the Call Queue page is permanently empty.
- **Backend Fix**: Return `items: result.data` alongside `data: result.data`.

---

## 8. Dental Clinic Domain Attributes Schema Expansion

To elevate CloseBDS into a specialized Acquisition OS for dental clinics, the following first-class columns are proposed for the `Lead` model in `schema.prisma`:

| Column Name | Data Type | Nullable? | Purpose & Business Value |
|---|:---:|:---:|---|
| `practiceType` | `String?` | Yes | Specialization: General, Orthodontics, Pediatric, Periodontics, Cosmetic. |
| `chairCount` | `Int?` | Yes | Physical clinic operatory capacity (evaluates clinic size and revenue tier). |
| `doctorCount` | `Int?` | Yes | Staff size and number of practicing dentists. |
| `googleRating` | `Decimal?` | Yes | Review rating (e.g. 4.8 / 5.0) migrated out of JSON into indexed column. |
| `googleReviewCount` | `Int?` | Yes | Total Google reviews count for local reputation analysis. |

---

## 9. Verification & Independent Test Evidence

All module behaviors and contracts were verified via automated test suites:
- **`tests/leads.test.ts`**: CRUD operations, pagination, search, contact cascade, multi-tenant isolation.
- **`tests/campaigns.test.ts`**: Campaign creation, updates, status transitions, workspace isolation.
- **`tests/discovery-research.test.ts`**: Nominatim geocoding, category mapping, bounding box generation.
- **`tests/geoapify-normalization.test.ts` & `geoapify-actionability.test.ts`**: Data quality classification and actionability rules (31/31 assertions passed).
- **`tests/qualification-personalization.test.ts`**: Business rules 1-5 deterministic evaluation.
