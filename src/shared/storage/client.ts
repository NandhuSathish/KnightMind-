import type { UserSettings, SiteConfig } from './schema.js';
import type { ChessSite } from '../chess/types.js';
import { DEFAULT_SETTINGS, DEFAULT_SITE_CONFIG } from './schema.js';

// ─── Settings ────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<UserSettings> {
  try {
    const data = await chrome.storage.local.get('settings');
    const stored = data['settings'] as UserSettings | undefined;
    return stored ? { ...DEFAULT_SETTINGS, ...stored } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function setSettings(patch: Partial<UserSettings>): Promise<void> {
  const current = await getSettings();
  await chrome.storage.local.set({ settings: { ...current, ...patch } });
}

// ─── Site Config ─────────────────────────────────────────────────────────────

export async function getSiteConfig(site: ChessSite): Promise<SiteConfig> {
  try {
    const key = `siteConfig_${site}`;
    const data = await chrome.storage.local.get(key);
    const stored = data[key] as SiteConfig | undefined;
    return stored ? { ...DEFAULT_SITE_CONFIG, ...stored } : { ...DEFAULT_SITE_CONFIG };
  } catch {
    return { ...DEFAULT_SITE_CONFIG };
  }
}

export async function setSiteConfig(
  site: ChessSite,
  patch: Partial<SiteConfig>
): Promise<void> {
  const current = await getSiteConfig(site);
  await chrome.storage.local.set({
    [`siteConfig_${site}`]: { ...current, ...patch },
  });
}

// ─── Storage quota guard ─────────────────────────────────────────────────────

/** Clears analysis cache keys, preserving only settings and site config. */
export async function clearAnalysisCache(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keysToRemove = Object.keys(all).filter(
    k => !k.startsWith('siteConfig_') && k !== 'settings' && k !== 'version'
  );
  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove);
  }
}
