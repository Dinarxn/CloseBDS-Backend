# closeVDS Lead Discovery Engine Specification

## 1. Objective & Scope

The **Lead Discovery Engine** identifies business prospects matching campaign targeting parameters (niche + location + criteria) and prepares structured, deduplicated candidate records for AI qualification.

$$\text{User Campaign Request} \longrightarrow \text{Provider API Fetch} \longrightarrow \text{Normalization} \longrightarrow \text{4-Factor Deduplication} \longrightarrow \text{Save Lead (Status: NEW)}$$

---

## 2. Lead Data Schema & Required Fields

The discovery pipeline captures and standardizes the following canonical lead attributes:

- **Business Name**: Normalized company name string (e.g., "Bright Smile Dental").
- **Target Category / Niche**: Configured niche tag (e.g., "Dental Clinic").
- **Location**: City, region, or geographic area (e.g., "London, UK").
- **Website Domain**: Full valid URL (e.g., `https://brightsmiledental.co.uk`).
- **Public Contact Details**: Legitimate public email addresses, phone numbers, and address string where available.
- **Lead Source**: Metadata tag identifying discovery origin (e.g., `GoogleMapsAPI`, `ApifyProvider`).
- **Discovery Timestamp**: UTC timestamp of initial discovery.
- **Lead Status**: Initial state set to `NEW`.

---

## 3. Normalization & 4-Factor Deduplication Algorithm

To eliminate duplicate records and avoid sending redundant outreach, every candidate lead passes through a mandatory 4-factor normalization and deduplication pipeline.

### A. Normalization Rules
- **Name**: Trim whitespace, convert to lowercase, strip trailing legal suffixes ("Ltd", "Inc", "LLC") for matching logic.
- **Domain**: Strip protocol (`http://`, `https://`), strip leading `www.`, remove trailing slashes, convert to lowercase.
- **Phone**: Strip all non-numeric characters; normalize to E.164 international format where applicable.
- **Address**: Lowercase and normalize common street abbreviations ("St" -> "Street", "Rd" -> "Road").

### B. Deduplication Match Key
A candidate lead is flagged as a **DUPLICATE** and skipped if any of the following match existing database records within the active Workspace:

1. **Exact Domain Match**: `Domain(Candidate) == Domain(Existing)`
2. **Name + City Match**: `NormName(Candidate) == NormName(Existing)` AND `City(Candidate) == City(Existing)`
3. **Phone Match**: `NormPhone(Candidate) == NormPhone(Existing)` (when phone exists)
4. **Normalized Composite Key Match**:
   $$\text{CompositeKey} = \text{NormName} + \text{Domain} + \text{NormPhone} + \text{NormAddress}$$

---

## 4. Ethical Sourcing & Compliance Standards

- **Legitimate Data Sources**: Discovery operates strictly via provider-approved APIs, official public APIs, or compliant data aggregators.
- **No CAPTCHA / Anti-Bot Evasion**: The system will **NEVER** utilize CAPTCHA-solving services, IP rotation proxies for bot-evasion, or unauthorized scraping scripts that violate website terms of service.
- **Factuality Maintenance**: Missing fields remain `null` or `unknown`. The discovery engine **NEVER** fabricates or guesses missing email addresses or phone numbers.
