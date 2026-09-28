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

export interface NormalizedWebsiteResult {
  websiteUrl?: string;
  domain?: string;
}

export interface ValidatedCoordinates {
  latitude?: number;
  longitude?: number;
}

export interface TargetedMapsUrlInput {
  businessName: string;
  address?: string;
  latitude?: number;
  longitude?: number;
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

/**
 * Builds a deterministic Google Maps search URL from business name, address, and coordinates.
 * Does NOT claim Geoapify place_id is a Google Place ID.
 */
export function buildTargetedMapsUrl(params: TargetedMapsUrlInput): string | undefined {
  const bizName = params.businessName?.trim();
  if (!bizName) {
    return undefined;
  }

  const coords = validateCoordinates(params.latitude, params.longitude);
  const cleanAddr = params.address?.trim();

  let query: string;

  if (cleanAddr) {
    // Highly specific: "Business Name, 10 Fleet Street, London, EC4Y 1AA, United Kingdom"
    query = `${bizName}, ${cleanAddr}`;
  } else if (coords.latitude !== undefined && coords.longitude !== undefined) {
    // If no address but coords exist: "Business Name 51.5074,-0.1278"
    query = `${bizName} ${coords.latitude},${coords.longitude}`;
  } else {
    query = bizName;
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
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
