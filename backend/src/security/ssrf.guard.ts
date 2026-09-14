import { URL } from 'url';
import net from 'net';

/**
 * Checks if an IP address string is in a private/internal or reserved subnet.
 */
export function isPrivateIp(ip: string): boolean {
  if (!net.isIP(ip)) {
    return false;
  }

  // IPv4 Checks
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;

    // Loopback (127.0.0.0/8)
    if (a === 127) return true;
    // Private Network 10.0.0.0/8
    if (a === 10) return true;
    // Private Network 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // Private Network 192.168.0.0/16
    if (a === 192 && b === 168) return true;
    // Link-Local / Cloud Metadata (169.254.0.0/16, specifically 169.254.169.254)
    if (a === 169 && b === 254) return true;
    // Current Network 0.0.0.0/8
    if (a === 0) return true;
    // Broadcast
    if (ip === '255.255.255.255') return true;

    return false;
  }

  // IPv6 Checks
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    // IPv6 Loopback
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
    // IPv6 Unspecified
    if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;
    // IPv6 Unique Local (fc00::/7)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // IPv6 Link-Local (fe80::/10)
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
    // IPv4-mapped IPv6 (::ffff:127.0.0.1 etc)
    if (lower.startsWith('::ffff:')) {
      const ipv4Part = ip.substring(7);
      return isPrivateIp(ipv4Part);
    }
  }

  return false;
}

/**
 * Validates a target website URL to prevent Server-Side Request Forgery (SSRF).
 * Blocks internal localhost, cloud metadata, RFC1918 subnets, and non-web schemes.
 */
export function validateUrlForAudit(urlString: string): { safe: boolean; error?: string; normalizedUrl?: string } {
  if (!urlString || typeof urlString !== 'string') {
    return { safe: false, error: 'Target URL is required' };
  }

  let parsed: URL;
  try {
    const withProtocol = urlString.startsWith('http://') || urlString.startsWith('https://')
      ? urlString
      : `https://${urlString}`;
    parsed = new URL(withProtocol);
  } catch {
    return { safe: false, error: 'Invalid URL format' };
  }

  // Enforce HTTP / HTTPS only
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, error: `Disallowed protocol: ${parsed.protocol}. Only http: and https: are allowed.` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost aliases
  if (
    hostname === 'localhost' ||
    hostname === 'localhost.localdomain' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1'
  ) {
    return { safe: false, error: 'Access to localhost and loopback addresses is blocked by security policy.' };
  }

  // Block Cloud Provider Metadata Hostnames (AWS, GCP, Azure, DigitalOcean)
  if (
    hostname === '169.254.169.254' ||
    hostname === 'metadata.google.internal' ||
    hostname === 'instance-data'
  ) {
    return { safe: false, error: 'Access to cloud instance metadata service is blocked by security policy.' };
  }

  // Check if direct IP address is private
  if (net.isIP(hostname) && isPrivateIp(hostname)) {
    return { safe: false, error: 'Access to private and internal IP ranges is blocked by security policy.' };
  }

  return { safe: true, normalizedUrl: parsed.toString() };
}
