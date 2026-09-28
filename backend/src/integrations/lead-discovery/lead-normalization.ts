/**
 * Lead Data Quality & Normalization Foundation
 * Phase B1: Geoapify Lead Data Quality
 */

export type LeadDataQuality = 'COMPLETE' | 'PARTIAL' | 'MINIMAL';

export interface StructuredAddressInput {
  housenumber?: string | null;
  street?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postcode?: string | null;
  country?: string | null;
  formatted?: string | null;
}

export interface NormalizedPhonesResult {
  primaryPhone?: string;
  additionalPhones: string[];
}

export interface NormalizedEmailsResult {
  email?: string;
  additionalEmails: string[];
}

export interface NormalizedWebsiteResult {
  websiteUrl?: string;
  domain?: string;
}

export type MapsMatchStatus = 'TARGETED' | 'UNVERIFIED';

export interface ValidatedCoordinates {
  latitude?: number;
  longitude?: number;
}

export interface TargetedMapsUrlInput {
  businessName?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface TargetedMapsUrlResult {
  mapsUrl?: string;
  mapsMatchStatus?: MapsMatchStatus;
}

/**
 * Phase B4: Lead Quality, Actionability & Channel Eligibility Types
 */
export type LeadActionabilityTier =
  | 'READY'
  | 'ENRICHMENT_REQUIRED'
  | 'ARCHIVED_WEAK';

export type LeadEligibilityChannel =
  | 'VOICE'
  | 'EMAIL'
  | 'WEBSITE_AUDIT';

export type LeadMissingField =
  | 'PHONE'
  | 'EMAIL'
  | 'WEBSITE'
  | 'ADDRESS'
  | 'COORDINATES';

export interface LeadActionability {
  tier: LeadActionabilityTier;
  isActionable: boolean;
  eligibleChannels: LeadEligibilityChannel[];
  missingFields: LeadMissingField[];
  reasons: string[];
}

export interface EvaluateLeadActionabilityInput {
  businessName?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  email?: string | null;
  websiteUrl?: string | null;
  domain?: string | null;
}

export interface DataQualityClassificationInput {
  businessName: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  email?: string | null;
  websiteUrl?: string | null;
  domain?: string | null;
}

export interface PlaceDetailsRawProperties {
  name?: string;
  website?: string;
  website_other?: string[] | string;
  contact?: {
    phone?: string;
    phone_other?: string[] | string;
    email?: string;
    email_other?: string[] | string;
    website?: string;
  };
  housenumber?: string;
  street?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  country_code?: string;
  formatted?: string;
  lat?: number;
  lon?: number;
  categories?: string[];
  [key: string]: unknown;
}

const GENERIC_SOCIAL_DOMAINS = new Set([
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'youtube.com',
  'tiktok.com',
  'linktr.ee',
  'google.com',
  'maps.google.com',
  'yelp.com',
  'tripadvisor.com',
  'wix.com',
  'squarespace.com',
  'wordpress.com',
  'github.io',
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
]);

/**
 * Validates latitude and longitude values.
 * - Latitude: finite number between -90 and 90
 * - Longitude: finite number between -180 and 180
 */
export function validateCoordinates(lat: unknown, lon: unknown): ValidatedCoordinates {
  const parsedLat = typeof lat === 'number' ? lat : typeof lat === 'string' ? parseFloat(lat) : NaN;
  const parsedLon = typeof lon === 'number' ? lon : typeof lon === 'string' ? parseFloat(lon) : NaN;

  const isLatValid = Number.isFinite(parsedLat) && parsedLat >= -90 && parsedLat <= 90;
  const isLonValid = Number.isFinite(parsedLon) && parsedLon >= -180 && parsedLon <= 180;

  return {
    latitude: isLatValid ? parsedLat : undefined,
    longitude: isLonValid ? parsedLon : undefined,
  };
}

/**
 * Constructs the best available canonical address from structured fields.
 * Deduplicates overlapping components (e.g. street name in line 1, city in line 2)
 * and falls back to formatted address only when structured components are missing.
 * Never invents house number, postcode, city, or country.
 */
export function normalizeStructuredAddress(input: StructuredAddressInput): string | undefined {
  const clean = (val?: string | null) => (val && typeof val === 'string' ? val.trim() : undefined);

  const housenumber = clean(input.housenumber);
  const street = clean(input.street);
  const line1 = clean(input.address_line1);
  const line2 = clean(input.address_line2);
  const city = clean(input.city);
  const state = clean(input.state);
  const postcode = clean(input.postcode);
  const country = clean(input.country);
  const formatted = clean(input.formatted);

  // 1. Determine the thoroughfare (street + house number or line1)
  let streetPart: string | undefined;
  if (housenumber && street) {
    // If street already starts with housenumber, avoid "10 10 Fleet Street"
    if (street.startsWith(housenumber)) {
      streetPart = street;
    } else {
      streetPart = `${housenumber} ${street}`;
    }
  } else if (street) {
    streetPart = street;
  } else if (line1) {
    streetPart = line1;
  }

  // 2. Assemble ordered distinct components
  const rawComponents: string[] = [];

  if (streetPart) {
    rawComponents.push(streetPart);
  }

  if (line2) {
    // Only include line2 if it is not just repeating streetPart
    if (!streetPart || !line2.toLowerCase().includes(streetPart.toLowerCase())) {
      rawComponents.push(line2);
    }
  }

  if (city) {
    rawComponents.push(city);
  }

  if (state) {
    rawComponents.push(state);
  }

  if (postcode) {
    rawComponents.push(postcode);
  }

  if (country) {
    rawComponents.push(country);
  }

  // 3. Deduplicate overlapping or sub-string components while preserving order
  if (rawComponents.length > 0) {
    const deduplicated: string[] = [];

    for (const comp of rawComponents) {
      const normalizedComp = comp.replace(/\s+/g, ' ').trim();
      if (!normalizedComp) continue;

      const lower = normalizedComp.toLowerCase();

      // Check if already present as an exact component
      const alreadyExists = deduplicated.some((existing) => existing.toLowerCase() === lower);
      if (alreadyExists) continue;

      // Check if this component is already entirely contained within a previous component
      // (e.g., if line 2 is "London, EC4Y 1AA" and city is "London" and postcode is "EC4Y 1AA")
      const alreadyCoveredInPrevious = deduplicated.some((existing) => {
        const existingLower = existing.toLowerCase();
        // Check word-boundary or comma-boundary match
        return (
          existingLower === lower ||
          existingLower.startsWith(`${lower},`) ||
          existingLower.endsWith(`, ${lower}`) ||
          existingLower.includes(`, ${lower},`)
        );
      });
      if (alreadyCoveredInPrevious) continue;

      // If this new component completely contains a previously added smaller component,
      // we can replace or keep; let's keep things clean and append
      deduplicated.push(normalizedComp);
    }

    if (deduplicated.length > 0) {
      // Clean duplicate commas and spaces
      const joined = deduplicated.join(', ').replace(/,\s*,+/g, ',').trim();
      return joined;
    }
  }

  // Fallback to formatted address if structured fields yielded nothing
  if (formatted) {
    const cleanedFormatted = formatted
      .replace(/\s+/g, ' ')
      .replace(/,\s*,+/g, ',')
      .trim();
    return cleanedFormatted.length > 0 ? cleanedFormatted : undefined;
  }

  return undefined;
}

/**
 * Normalizes phone string(s).
 * Handles multiple numbers separated by semicolon, comma, slash, pipe, or newline.
 * Preserves international prefix (+) without guessing or fabricating country codes.
 * Deterministically picks a primary number and deduplicates.
 */
export function normalizePhones(rawPhone?: string | null): NormalizedPhonesResult {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return { primaryPhone: undefined, additionalPhones: [] };
  }

  // Split on delimiters: ; | \n or / (when surrounded by spaces or between numbers)
  // or comma (when followed by space, digit, or +)
  const segments = rawPhone
    .split(/[;\n|]|\s+\/\s+|(?<=\d)\/(?=\+?\d)|,(?=\s*\+?\d)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const seenDigits = new Set<string>();
  const validPhones: string[] = [];

  for (const seg of segments) {
    // Normalize internal whitespace
    const cleanSeg = seg.replace(/\s+/g, ' ').trim();

    // Must have at least 5 digits to be considered a viable phone number
    const digitsOnly = cleanSeg.replace(/\D/g, '');
    if (digitsOnly.length < 5) {
      continue;
    }

    // Check for exact digit duplication
    if (seenDigits.has(digitsOnly)) {
      continue;
    }

    // Also check if existing entry has same ending (e.g. local vs international)
    // If current has '+' and existing didn't, we can replace or keep both;
    // but preserving distinct numbers is safer
    seenDigits.add(digitsOnly);
    validPhones.push(cleanSeg);
  }

  if (validPhones.length === 0) {
    return { primaryPhone: undefined, additionalPhones: [] };
  }

  // Deterministic primary phone: prefer the first one with an international '+' prefix,
  // otherwise take the first valid phone in order.
  const intlIndex = validPhones.findIndex((p) => p.startsWith('+'));
  let primaryPhone: string;
  let remaining: string[];

  if (intlIndex > 0) {
    primaryPhone = validPhones[intlIndex];
    remaining = validPhones.filter((_, idx) => idx !== intlIndex);
  } else {
    primaryPhone = validPhones[0];
    remaining = validPhones.slice(1);
  }

  return {
    primaryPhone,
    additionalPhones: remaining,
  };
}

/**
 * Normalizes website URL and extracts domain safely.
 * Adds missing protocol for parsing without destroying original path/protocol.
 * Rejects invalid URLs and filters out social media from being treated as business websites.
 */
export function normalizeWebsiteAndDomain(rawWebsite?: string | null): NormalizedWebsiteResult {
  if (!rawWebsite || typeof rawWebsite !== 'string') {
    return { websiteUrl: undefined, domain: undefined };
  }

  const trimmed = rawWebsite.trim();
  if (trimmed.length < 3) {
    return { websiteUrl: undefined, domain: undefined };
  }

  // Check for invalid protocols or obvious non-URLs
  if (trimmed.startsWith('javascript:') || trimmed.startsWith('mailto:') || trimmed.startsWith('data:')) {
    return { websiteUrl: undefined, domain: undefined };
  }

  // Ensure protocol exists for URL parsing
  let candidateUrl = trimmed;
  if (!/^https?:\/\//i.test(candidateUrl)) {
    candidateUrl = `https://${candidateUrl}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidateUrl);
  } catch {
    return { websiteUrl: undefined, domain: undefined };
  }

  // Ensure valid hostname with at least one dot and no spaces
  const hostname = parsed.hostname.toLowerCase().trim();
  if (!hostname.includes('.') || hostname.includes(' ') || hostname.length < 4) {
    return { websiteUrl: undefined, domain: undefined };
  }

  const cleanDomain = hostname.replace(/^www\./, '');

  // Check if it's a generic social media or hosted directory domain
  if (GENERIC_SOCIAL_DOMAINS.has(cleanDomain)) {
    return {
      websiteUrl: undefined,
      domain: undefined,
    };
  }

  // Preserved websiteUrl: if original had protocol, preserve it; otherwise use the normalized candidateUrl
  const finalWebsiteUrl = /^https?:\/\//i.test(trimmed) ? trimmed : candidateUrl;

  return {
    websiteUrl: finalWebsiteUrl,
    domain: cleanDomain,
  };
}

function safeDecodeComponent(str: string): string {
  try {
    if (/%[0-9a-fA-F]{2}/.test(str)) {
      return decodeURIComponent(str);
    }
  } catch {
    // If decoding fails, keep original
  }
  return str;
}

/**
 * Builds a deterministic Google Maps search URL and match status from business identity and location signals.
 * Uses the standard Google Maps Search API contract: https://www.google.com/maps/search/?api=1&query=...
 * Never fabricates Google Place IDs or CIDs.
 * Coordinates are validated and ordered as latitude, longitude.
 */
export function buildTargetedMapsDetails(params: TargetedMapsUrlInput): TargetedMapsUrlResult {
  const rawBiz = params.businessName && typeof params.businessName === 'string' ? params.businessName.trim() : '';
  const rawAddr = params.address && typeof params.address === 'string' ? params.address.trim() : '';

  const cleanBiz =
    rawBiz.toLowerCase() !== 'undefined' && rawBiz.toLowerCase() !== 'null'
      ? safeDecodeComponent(rawBiz).replace(/\s+/g, ' ').trim()
      : '';
  const cleanAddr =
    rawAddr.toLowerCase() !== 'undefined' && rawAddr.toLowerCase() !== 'null'
      ? safeDecodeComponent(rawAddr).replace(/\s+/g, ' ').trim()
      : '';

  const coords = validateCoordinates(params.latitude, params.longitude);
  const hasCoords = coords.latitude !== undefined && coords.longitude !== undefined;
  const hasBiz = cleanBiz.length > 0;
  const hasAddr = cleanAddr.length > 0;

  let query: string | undefined;
  let mapsMatchStatus: MapsMatchStatus | undefined;

  // Case A: Business Name + Full Address + Coordinates (strongest targeted query)
  if (hasBiz && hasAddr && hasCoords) {
    query = `${cleanBiz}, ${cleanAddr}, ${coords.latitude},${coords.longitude}`;
    mapsMatchStatus = 'TARGETED';
  }
  // Case B: Business Name + Address (targeted query without coordinates)
  else if (hasBiz && hasAddr) {
    query = `${cleanBiz}, ${cleanAddr}`;
    mapsMatchStatus = 'TARGETED';
  }
  // Case C: Business Name + Coordinates (targeted query without address)
  else if (hasBiz && hasCoords) {
    query = `${cleanBiz} ${coords.latitude},${coords.longitude}`;
    mapsMatchStatus = 'TARGETED';
  }
  // Fallback: Address + Coordinates (when business name is missing)
  else if (hasAddr && hasCoords) {
    query = `${cleanAddr}, ${coords.latitude},${coords.longitude}`;
    mapsMatchStatus = 'UNVERIFIED';
  }
  // Fallback: Address only
  else if (hasAddr) {
    query = cleanAddr;
    mapsMatchStatus = 'UNVERIFIED';
  }
  // Case D: Coordinates only (unverified coordinate pin)
  else if (hasCoords) {
    query = `${coords.latitude},${coords.longitude}`;
    mapsMatchStatus = 'UNVERIFIED';
  }
  // Fallback: Business name only (unverified name search)
  else if (hasBiz) {
    query = cleanBiz;
    mapsMatchStatus = 'UNVERIFIED';
  }
  // Case E: Nothing usable
  else {
    return { mapsUrl: undefined, mapsMatchStatus: undefined };
  }

  const normalizedQuery = query.replace(/\s+/g, ' ').replace(/,\s*,+/g, ',').trim();
  if (!normalizedQuery || normalizedQuery.toLowerCase() === 'undefined' || normalizedQuery.toLowerCase() === 'null') {
    return { mapsUrl: undefined, mapsMatchStatus: undefined };
  }

  const encodedQuery = encodeURIComponent(normalizedQuery);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedQuery}`;

  return {
    mapsUrl,
    mapsMatchStatus,
  };
}

/**
 * Builds a deterministic Google Maps search URL from business name, address, and coordinates.
 * Preserves backwards compatibility by returning string | undefined.
 * Does NOT claim Geoapify place_id is a Google Place ID.
 */
export function buildTargetedMapsUrl(params: TargetedMapsUrlInput): string | undefined {
  return buildTargetedMapsDetails(params).mapsUrl;
}

/**
 * Classifies data completeness into COMPLETE, PARTIAL, or MINIMAL.
 * Purely objective and descriptive based on available information; never invents data.
 */
export function classifyDataQuality(input: DataQualityClassificationInput): LeadDataQuality {
  const hasName = Boolean(input.businessName && input.businessName.trim().length > 0);
  if (!hasName) {
    return 'MINIMAL';
  }

  const hasAddress = Boolean(input.address && input.address.trim().length >= 5);
  const coords = validateCoordinates(input.latitude, input.longitude);
  const hasCoords = coords.latitude !== undefined && coords.longitude !== undefined;

  const hasPhone = Boolean(input.phone && input.phone.trim().length >= 5);
  const hasEmail = Boolean(input.email && input.email.includes('@'));
  const hasWeb = Boolean(input.websiteUrl || input.domain);
  const hasContact = hasPhone || hasEmail || hasWeb;

  // COMPLETE: Name + usable address + valid coordinates + usable contact method
  if (hasAddress && hasCoords && hasContact) {
    return 'COMPLETE';
  }

  // PARTIAL: Name + (usable address OR valid coordinates) OR (has contact info)
  if (hasAddress || hasCoords || hasContact) {
    return 'PARTIAL';
  }

  // MINIMAL: Name only or very weak location/contact
  return 'MINIMAL';
}

/**
  * Evaluates lead actionability, communication/research channel eligibility,
  * missing data fields, and factual quality reasons.
  * Pure deterministic function with zero external network or AI dependencies.
  */
export function evaluateLeadActionability(input: EvaluateLeadActionabilityInput): LeadActionability {
  // 1. Business name validation
  const rawBiz = typeof input.businessName === 'string' ? input.businessName.trim() : '';
  const hasName =
    rawBiz.length > 0 &&
    rawBiz.toLowerCase() !== 'undefined' &&
    rawBiz.toLowerCase() !== 'null';

  // 2. Address validation (usable address must have at least 5 characters)
  const rawAddr = typeof input.address === 'string' ? input.address.trim() : '';
  const hasAddress =
    rawAddr.length >= 5 &&
    rawAddr.toLowerCase() !== 'undefined' &&
    rawAddr.toLowerCase() !== 'null';

  // 3. Coordinates validation
  const coords = validateCoordinates(input.latitude, input.longitude);
  const hasCoordinates = coords.latitude !== undefined && coords.longitude !== undefined;

  // 4. Phone validation (must be valid under phone normalization)
  let hasPhone = false;
  if (input.phone && typeof input.phone === 'string') {
    const rawP = input.phone.trim();
    if (rawP.toLowerCase() !== 'undefined' && rawP.toLowerCase() !== 'null') {
      const normP = normalizePhones(rawP);
      hasPhone = Boolean(normP.primaryPhone && normP.primaryPhone.length >= 5);
    }
  }

  // 5. Email validation (must be valid under email normalization)
  let hasEmail = false;
  if (input.email && typeof input.email === 'string') {
    const rawE = input.email.trim();
    if (rawE.toLowerCase() !== 'undefined' && rawE.toLowerCase() !== 'null') {
      const normE = normalizeEmails(rawE);
      hasEmail = Boolean(normE.email && normE.email.includes('@'));
    }
  }

  // 6. Website / domain validation (must be valid under domain normalization)
  let hasWebsite = false;
  const webCandidate = input.websiteUrl || input.domain;
  if (webCandidate && typeof webCandidate === 'string') {
    const rawW = webCandidate.trim();
    if (rawW.toLowerCase() !== 'undefined' && rawW.toLowerCase() !== 'null') {
      const normW = normalizeWebsiteAndDomain(rawW);
      hasWebsite = Boolean(normW.domain && normW.domain.length >= 4);
    }
  }

  // 7. Channel eligibility
  const eligibleChannels: LeadEligibilityChannel[] = [];
  if (hasPhone) eligibleChannels.push('VOICE');
  if (hasEmail) eligibleChannels.push('EMAIL');
  if (hasWebsite) eligibleChannels.push('WEBSITE_AUDIT');

  // isActionable: True if lead has at least one verified channel to perform a meaningful next action
  const isActionable = eligibleChannels.length > 0;

  // 8. Missing fields
  const missingFields: LeadMissingField[] = [];
  if (!hasPhone) missingFields.push('PHONE');
  if (!hasEmail) missingFields.push('EMAIL');
  if (!hasWebsite) missingFields.push('WEBSITE');
  if (!hasAddress) missingFields.push('ADDRESS');
  if (!hasCoordinates) missingFields.push('COORDINATES');

  // 9. Factual reasons
  const reasons: string[] = [];
  if (!hasPhone) reasons.push('NO_PHONE');
  if (!hasEmail) reasons.push('NO_EMAIL');
  if (!hasWebsite) reasons.push('NO_WEBSITE');
  if (!hasAddress) reasons.push('NO_ADDRESS');
  if (!hasCoordinates) reasons.push('NO_COORDINATES');
  if (!hasPhone && !hasEmail) reasons.push('NO_DIRECT_CONTACT');
  if (!hasAddress || !hasCoordinates) reasons.push('INCOMPLETE_LOCATION');
  if (!hasName || (!hasAddress && !hasCoordinates && !hasPhone && !hasEmail && !hasWebsite)) {
    reasons.push('MINIMAL_BUSINESS_IDENTITY');
  }

  // 10. Actionability tier
  let tier: LeadActionabilityTier;
  const hasDirectContact = hasPhone || hasEmail;
  const hasSufficientLocation = hasAddress && hasCoordinates;

  if (hasName && hasSufficientLocation && hasDirectContact) {
    tier = 'READY';
  } else if (!hasDirectContact && !hasWebsite && !hasAddress) {
    // Missing all contact/audit channels and missing full address (e.g. name only, coords only, name+coords only, empty)
    tier = 'ARCHIVED_WEAK';
  } else {
    // Has meaningful identity/location/contact, but requires enrichment (e.g. website only, address+website no phone, phone+coords no address)
    tier = 'ENRICHMENT_REQUIRED';
  }

  return {
    tier,
    isActionable,
    eligibleChannels,
    missingFields,
    reasons,
  };
}

/**
 * Normalizes email address(es).
 * Validates structure, lowercases, deduplicates case-insensitively,
 * deterministically selects a primary email and returns additional emails.
 * Never invents, guesses, or fabricates emails.
 */
export function normalizeEmails(
  primaryCandidate?: string | null,
  additionalCandidates?: Array<string | null | undefined> | string | null
): NormalizedEmailsResult {
  const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

  const rawList: string[] = [];

  if (primaryCandidate && typeof primaryCandidate === 'string') {
    rawList.push(...primaryCandidate.split(/[;,\n|]+/).map((s) => s.trim()).filter(Boolean));
  }

  if (Array.isArray(additionalCandidates)) {
    for (const item of additionalCandidates) {
      if (item && typeof item === 'string') {
        rawList.push(...item.split(/[;,\n|]+/).map((s) => s.trim()).filter(Boolean));
      }
    }
  } else if (additionalCandidates && typeof additionalCandidates === 'string') {
    rawList.push(...additionalCandidates.split(/[;,\n|]+/).map((s) => s.trim()).filter(Boolean));
  }

  const seen = new Set<string>();
  const validEmails: string[] = [];

  for (const raw of rawList) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    if (!EMAIL_REGEX.test(trimmed)) {
      continue;
    }

    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) {
      continue;
    }
    seen.add(lower);
    validEmails.push(lower);
  }

  if (validEmails.length === 0) {
    return { email: undefined, additionalEmails: [] };
  }

  return {
    email: validEmails[0],
    additionalEmails: validEmails.slice(1),
  };
}

export interface SafeEnrichmentMergeInput {
  existingName: string;
  existingAddress?: string | null;
  existingPhone?: string | null;
  existingAdditionalPhones?: string[];
  existingWebsite?: string | null;
  existingDomain?: string | null;
  existingLatitude?: number | null;
  existingLongitude?: number | null;
  existingPlaceId?: string | null;
  existingEmail?: string | null;
  existingAdditionalEmails?: string[];
  existingMapsUrl?: string | null;
  existingMapsMatchStatus?: MapsMatchStatus | null;
  details?: PlaceDetailsRawProperties | null;
}

export interface SafeEnrichmentMergeResult {
  businessName: string;
  canonicalAddress?: string;
  primaryPhone?: string;
  additionalPhones: string[];
  email?: string;
  additionalEmails: string[];
  websiteUrl?: string;
  additionalWebsites: string[];
  domain?: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
  mapsUrl?: string;
  mapsMatchStatus?: MapsMatchStatus;
  dataQuality: LeadDataQuality;
  actionability: LeadActionability;
  placeDetailsEnriched: boolean;
}

/**
 * Safely and additively merges Place Details into existing lead candidate data.
 * Existing valid information is never destructively overwritten with null/empty values.
 * No emails, phones, or websites are fabricated or inferred.
 */
export function safeMergePlaceDetails(input: SafeEnrichmentMergeInput): SafeEnrichmentMergeResult {
  const details = input.details || {};
  const hasDetails = Boolean(input.details && Object.keys(input.details).length > 0);

  // 1. Business Name: preserve existing trusted name, fallback to details name
  const businessName = input.existingName?.trim() || details.name?.trim() || 'Unnamed Business';

  // 2. Structured Address: build details address and merge conservatively
  let detailsAddress: string | undefined;
  if (hasDetails) {
    detailsAddress = normalizeStructuredAddress({
      housenumber: details.housenumber,
      street: details.street,
      address_line1: details.address_line1,
      address_line2: details.address_line2,
      city: details.city,
      state: details.state,
      postcode: details.postcode,
      country: details.country,
      formatted: details.formatted,
    });
  }

  // Preserve existing address if already valid and more detailed, or use enriched details
  let canonicalAddress: string | undefined;
  if (input.existingAddress && input.existingAddress.trim().length > 0) {
    // If details address has more information (e.g. includes postcode while existing didn't)
    if (detailsAddress && detailsAddress.length > input.existingAddress.length) {
      canonicalAddress = detailsAddress;
    } else {
      canonicalAddress = input.existingAddress.trim();
    }
  } else {
    canonicalAddress = detailsAddress;
  }

  // 3. Phone Enrichment: merge existing + details contact.phone + details contact.phone_other + top-level / datasource phone
  const phoneCandidates: string[] = [];
  if (input.existingPhone) {
    phoneCandidates.push(input.existingPhone);
  }
  if (Array.isArray(input.existingAdditionalPhones)) {
    phoneCandidates.push(...input.existingAdditionalPhones);
  }
  if (details.contact?.phone) {
    phoneCandidates.push(details.contact.phone);
  }
  if (typeof (details as any).phone === 'string') {
    phoneCandidates.push((details as any).phone);
  }
  const rawDsPhone = (details.datasource as any)?.raw?.phone || (details.datasource as any)?.raw?.['contact:phone'];
  if (typeof rawDsPhone === 'string') {
    phoneCandidates.push(rawDsPhone);
  }
  if (Array.isArray(details.contact?.phone_other)) {
    for (const p of details.contact.phone_other) {
      if (p) phoneCandidates.push(p);
    }
  } else if (details.contact?.phone_other && typeof details.contact.phone_other === 'string') {
    phoneCandidates.push(details.contact.phone_other);
  }

  const mergedPhones = normalizePhones(phoneCandidates.join(';'));
  const primaryPhone = mergedPhones.primaryPhone;
  const additionalPhones = mergedPhones.additionalPhones;

  // 4. Email Enrichment: merge existing + details contact.email + details contact.email_other + top-level / datasource email
  const rawDsEmail = (details.datasource as any)?.raw?.email || (details.datasource as any)?.raw?.['contact:email'];
  const detailsEmail = details.contact?.email || (typeof (details as any).email === 'string' ? (details as any).email : undefined) || (typeof rawDsEmail === 'string' ? rawDsEmail : undefined);
  const primaryEmailCandidate = input.existingEmail || detailsEmail || undefined;
  const additionalEmailCandidates: string[] = [];
  if (Array.isArray(input.existingAdditionalEmails)) {
    additionalEmailCandidates.push(...input.existingAdditionalEmails);
  }
  if (input.existingEmail && detailsEmail && input.existingEmail.toLowerCase() !== detailsEmail.toLowerCase()) {
    additionalEmailCandidates.push(detailsEmail);
  }
  if (Array.isArray(details.contact?.email_other)) {
    for (const e of details.contact.email_other) {
      if (e) additionalEmailCandidates.push(e);
    }
  } else if (details.contact?.email_other && typeof details.contact.email_other === 'string') {
    additionalEmailCandidates.push(details.contact.email_other);
  }

  const mergedEmails = normalizeEmails(primaryEmailCandidate, additionalEmailCandidates);

  // 5. Website & Domain Enrichment:
  // Primary website: prefer existing valid official website or details website
  const webCandidates: string[] = [];
  if (input.existingWebsite) {
    webCandidates.push(input.existingWebsite);
  }
  if (details.website) {
    webCandidates.push(details.website);
  }
  if (details.contact?.website) {
    webCandidates.push(details.contact.website);
  }
  const rawDsWeb = (details.datasource as any)?.raw?.website || (details.datasource as any)?.raw?.['contact:website'] || (details.datasource as any)?.raw?.url;
  if (typeof rawDsWeb === 'string') {
    webCandidates.push(rawDsWeb);
  }
  if (Array.isArray(details.website_other)) {
    for (const w of details.website_other) {
      if (w) webCandidates.push(w);
    }
  } else if (details.website_other && typeof details.website_other === 'string') {
    webCandidates.push(details.website_other);
  }

  let websiteUrl: string | undefined;
  let domain: string | undefined = input.existingDomain || undefined;
  const additionalWebsites: string[] = [];

  for (const rawW of webCandidates) {
    const norm = normalizeWebsiteAndDomain(rawW);
    if (!norm.websiteUrl || !norm.domain) {
      continue;
    }
    if (!websiteUrl) {
      websiteUrl = norm.websiteUrl;
      domain = domain || norm.domain;
    } else if (norm.websiteUrl !== websiteUrl && !additionalWebsites.includes(norm.websiteUrl)) {
      additionalWebsites.push(norm.websiteUrl);
    }
  }

  // 6. Coordinates: preserve existing valid coordinates, fallback to details coords
  const existingCoords = validateCoordinates(input.existingLatitude, input.existingLongitude);
  let latitude = existingCoords.latitude;
  let longitude = existingCoords.longitude;

  if (latitude === undefined || longitude === undefined) {
    const detailsCoords = validateCoordinates(details.lat, details.lon);
    if (latitude === undefined) latitude = detailsCoords.latitude;
    if (longitude === undefined) longitude = detailsCoords.longitude;
  }

  // 7. Place ID: preserve existing
  const placeId = input.existingPlaceId || undefined;

  // 8. Targeted Maps URL & Match Status
  const computedMaps = buildTargetedMapsDetails({
    businessName,
    address: canonicalAddress,
    latitude,
    longitude,
  });

  // Preserve valid existing mapsUrl if newly computed is missing or weaker
  let mapsUrl = computedMaps.mapsUrl;
  let mapsMatchStatus = computedMaps.mapsMatchStatus;

  if (input.existingMapsUrl && input.existingMapsUrl.trim().startsWith('http')) {
    if (!mapsUrl) {
      mapsUrl = input.existingMapsUrl.trim();
      mapsMatchStatus = input.existingMapsMatchStatus || 'UNVERIFIED';
    } else if (input.existingMapsMatchStatus === 'TARGETED' && mapsMatchStatus === 'UNVERIFIED') {
      mapsUrl = input.existingMapsUrl.trim();
      mapsMatchStatus = 'TARGETED';
    }
  }

  // 9. Data Quality Classification
  const dataQuality = classifyDataQuality({
    businessName,
    address: canonicalAddress,
    latitude,
    longitude,
    phone: primaryPhone,
    email: mergedEmails.email,
    websiteUrl,
    domain,
  });

  // 10. Actionability & Channel Eligibility Evaluation
  const actionability = evaluateLeadActionability({
    businessName,
    address: canonicalAddress,
    latitude,
    longitude,
    phone: primaryPhone,
    email: mergedEmails.email,
    websiteUrl,
    domain,
  });

  return {
    businessName,
    canonicalAddress,
    primaryPhone,
    additionalPhones,
    email: mergedEmails.email,
    additionalEmails: mergedEmails.additionalEmails,
    websiteUrl,
    additionalWebsites,
    domain,
    latitude,
    longitude,
    placeId,
    mapsUrl,
    mapsMatchStatus,
    dataQuality,
    actionability,
    placeDetailsEnriched: hasDetails,
  };
}
