/**
 * Lightweight app-wide i18n.
 *
 * UI strings were hardcoded English everywhere, which undercut the app's
 * core multilingual pitch. This module externalizes the high-visibility
 * shared strings (nav labels, confirmations, chat chrome, search prompt)
 * with translations for the app's primary languages. Missing keys or
 * missing translations fall back to English, then to the key itself — so a
 * gap never renders an empty label.
 *
 * The UI language is persisted (survives logout — it is a device
 * preference, not account data) and is intentionally independent of each
 * chat's translation languages.
 */
import { useSyncExternalStore } from 'react';
import { storage } from '@/lib/storage';

export type AppLang = 'en' | 'te' | 'hi' | 'ta' | 'kn';

export const APP_LANGS: { code: AppLang; label: string; english: string }[] = [
  { code: 'en', label: 'English', english: 'English' },
  { code: 'te', label: 'తెలుగు', english: 'Telugu' },
  { code: 'hi', label: 'हिन्दी', english: 'Hindi' },
  { code: 'ta', label: 'தமிழ்', english: 'Tamil' },
  { code: 'kn', label: 'ಕನ್ನಡ', english: 'Kannada' },
];

// Deliberately NOT under the `workmithra:` prefix — clearAllWorkMitraStorage()
// wipes that namespace on logout, but the UI language is a device preference
// that should survive account switches.
const LANG_STORAGE_KEY = 'app_ui_language';

type StringMap = Partial<Record<AppLang, string>>;

const STRINGS: Record<string, StringMap> = {
  // Bottom navigation
  'nav.home': { en: 'Home', te: 'హోమ్', hi: 'होम', ta: 'முகப்பு', kn: 'ಮುಖಪುಟ' },
  'nav.bookings': { en: 'Bookings', te: 'బుకింగ్స్', hi: 'बुकिंग', ta: 'முன்பதிவுகள்', kn: 'ಬುಕಿಂಗ್ಸ್' },
  'nav.switch_role': { en: 'Switch', te: 'మార్చు', hi: 'बदलें', ta: 'மாற்று', kn: 'ಬದಲಿಸಿ' },
  'nav.profile': { en: 'Profile', te: 'ప్రొఫైల్', hi: 'प्रोफ़ाइल', ta: 'சுயவிவரம்', kn: 'ಪ್ರೊಫೈಲ್' },
  'nav.dashboard': { en: 'Dashboard', te: 'డాష్‌బోర్డ్', hi: 'डैशबोर्ड', ta: 'டாஷ்போர்டு', kn: 'ಡ್ಯಾಶ್‌ಬೋರ್ಡ್' },
  'nav.requests': { en: 'Requests', te: 'అభ్యర్థనలు', hi: 'अनुरोध', ta: 'கோரிக்கைகள்', kn: 'ವಿನಂತಿಗಳು' },
  'nav.hours': { en: 'Hours', te: 'గంటలు', hi: 'घंटे', ta: 'நேரம்', kn: 'ಸಮಯ' },

  // Common actions
  'common.cancel': { en: 'Cancel', te: 'రద్దు', hi: 'रद्द करें', ta: 'ரத்து', kn: 'ರದ್ದು' },
  'common.continue': { en: 'Continue', te: 'కొనసాగించు', hi: 'जारी रखें', ta: 'தொடரவும்', kn: 'ಮುಂದುವರಿಸಿ' },
  'common.logout': { en: 'Logout', te: 'లాగ్ అవుట్', hi: 'लॉग आउट', ta: 'வெளியேறு', kn: 'ಲಾಗ್ ಔಟ್' },
  'common.switch': { en: 'Switch', te: 'మార్చు', hi: 'बदलें', ta: 'மாற்று', kn: 'ಬದಲಿಸಿ' },
  'common.loading': { en: 'Loading…', te: 'లోడ్ అవుతోంది…', hi: 'लोड हो रहा है…', ta: 'ஏற்றுகிறது…', kn: 'ಲೋಡ್ ಆಗುತ್ತಿದೆ…' },

  // Switch role / logout confirmations
  'auth.switchTitle': {
    en: 'Switch role / logout',
    te: 'రోల్ మార్చు / లాగ్ అవుట్',
    hi: 'भूमिका बदलें / लॉग आउट',
    ta: 'பங்கு மாற்று / வெளியேறு',
    kn: 'ಪಾತ್ರ ಬದಲಿಸಿ / ಲಾಗ್ ಔಟ್',
  },
  'auth.switchMessage': {
    en: 'You will be signed out of this session and taken to the login screen. Continue?',
    te: 'మీరు ఈ సెషన్ నుండి లాగ్ అవుట్ అయి లాగిన్ స్క్రీన్‌కు వెళ్తారు. కొనసాగించాలా?',
    hi: 'आप इस सेशन से लॉग आउट होकर लॉगिन स्क्रीन पर जाएँगे। जारी रखें?',
    ta: 'இந்த அமர்விலிருந்து வெளியேறி உள்நுழைவு திரைக்குச் செல்வீர்கள். தொடரவா?',
    kn: 'ಈ ಸೆಶನ್‌ನಿಂದ ಲಾಗ್ ಔಟ್ ಆಗಿ ಲಾಗಿನ್ ಸ್ಕ್ರೀನ್‌ಗೆ ಹೋಗುತ್ತೀರಿ. ಮುಂದುವರಿಸುವುದೇ?',
  },
  'auth.switchRoleMessage': {
    en: 'You will be logged out so you can sign in with a different role. Continue?',
    te: 'వేరే రోల్‌తో లాగిన్ అవ్వడానికి మీరు లాగ్ అవుట్ అవుతారు. కొనసాగించాలా?',
    hi: 'दूसरी भूमिका से लॉगिन करने के लिए आपको लॉग आउट किया जाएगा। जारी रखें?',
    ta: 'வேறு பங்கில் உள்நுழைய நீங்கள் வெளியேற்றப்படுவீர்கள். தொடரவா?',
    kn: 'ಬೇರೆ ಪಾತ್ರದೊಂದಿಗೆ ಲಾಗಿನ್ ಆಗಲು ನೀವು ಲಾಗ್ ಔಟ್ ಆಗುತ್ತೀರಿ. ಮುಂದುವರಿಸುವುದೇ?',
  },
  'auth.logoutTitle': { en: 'Logout', te: 'లాగ్ అవుట్', hi: 'लॉग आउट', ta: 'வெளியேறு', kn: 'ಲಾಗ್ ಔಟ್' },
  'auth.logoutMessage': {
    en: 'Are you sure you want to log out?',
    te: 'మీరు ఖచ్చితంగా లాగ్ అవుట్ కావాలనుకుంటున్నారా?',
    hi: 'क्या आप वाकई लॉग आउट करना चाहते हैं?',
    ta: 'நிச்சயமாக வெளியேற விரும்புகிறீர்களா?',
    kn: 'ನೀವು ಖಚಿತವಾಗಿ ಲಾಗ್ ಔಟ್ ಮಾಡಲು ಬಯಸುವಿರಾ?',
  },

  // Chat chrome
  'chat.onlineAutoTranslate': {
    en: 'online · auto-translate',
    te: 'ఆన్‌లైన్ · ఆటో-అనువాదం',
    hi: 'ऑनलाइन · स्वतः अनुवाद',
    ta: 'இணையத்தில் · தானியங்கு மொழிபெயர்ப்பு',
    kn: 'ಆನ್‌ಲೈನ್ · ಸ್ವಯಂ ಅನುವಾದ',
  },
  'chat.youSpeak': {
    en: 'You speak',
    te: 'మీ భాష',
    hi: 'आपकी भाषा',
    ta: 'உங்கள் மொழி',
    kn: 'ನಿಮ್ಮ ಭಾಷೆ',
  },
  // {name} is replaced with the other participant's name/label.
  'chat.otherSpeaks': {
    en: '{name} speaks',
    te: '{name} భాష',
    hi: '{name} की भाषा',
    ta: '{name} மொழி',
    kn: '{name} ಭಾಷೆ',
  },
  'chat.placeholder': {
    en: 'Type a message…',
    te: 'సందేశం టైప చేయండి…',
    hi: 'संदेश लिखें…',
    ta: 'செய்தியை உள்ளிடவும்…',
    kn: 'ಸಂದೇಶವನ್ನು ಟೈಪ್ ಮಾಡಿ…',
  },
  // {lang} is replaced with the selected language code (EN/TE/…).
  'chat.typePlaceholder': {
    en: 'Type in {lang} or any language…',
    te: '{lang}లో లేదా ఏ భాషలోనైనా టైప చేయండి…',
    hi: '{lang} या किसी भाषा में लिखें…',
    ta: '{lang} அல்லது எந்த மொழியிலும் உள்ளிடவும்…',
    kn: '{lang} ಅಥವಾ ಯಾವುದೇ ಭಾಷೆಯಲ್ಲಿ ಟೈಪ್ ಮಾಡಿ…',
  },

  // Home search
  'home.searchPlaceholder': {
    en: 'Say or type what you need — AI will find it',
    te: 'మీకు కావలసినది చెప్పండి లేదా టైప్ చేయండి — AI కనుగొంటుంది',
    hi: 'जो चाहिए उसे बोलें या लिखें — AI ढूँढेगा',
    ta: 'தேவையானதை சொல்லுங்கள் அல்லது உள்ளிடுங்கள் — AI கண்டுபிடிக்கும்',
    kn: 'ಬೇಕಾದದ್ದನ್ನು ಹೇಳಿ ಅಥವಾ ಟೈಪ್ ಮಾಡಿ — AI ಹುಡುಕುತ್ತದೆ',
  },
};

let current: AppLang = 'en';
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function isAppLang(value: unknown): value is AppLang {
  return typeof value === 'string' && APP_LANGS.some((l) => l.code === value);
}

/** Translate a key. Unknown keys fall back to `fallback`, then the key. */
export function t(key: string, params?: Record<string, string | number>, fallback?: string): string {
  let text = STRINGS[key]?.[current] ?? STRINGS[key]?.en ?? fallback ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
    }
  }
  return text;
}

export function getAppLanguage(): AppLang {
  return current;
}

/** Load the persisted UI language. Call once at app startup. */
export async function initI18n(): Promise<void> {
  try {
    const saved = await storage.get(LANG_STORAGE_KEY);
    if (isAppLang(saved) && saved !== current) {
      current = saved;
      emit();
    }
  } catch {
    // keep the default
  }
}

/** Change the UI language and persist it. */
export async function setAppLanguage(lang: AppLang): Promise<void> {
  if (!isAppLang(lang) || lang === current) return;
  current = lang;
  emit();
  try {
    await storage.set(LANG_STORAGE_KEY, lang);
  } catch {
    // in-memory switch still works for this session
  }
}

/**
 * React binding — components re-render when the language changes.
 * Returns a bound `t` for convenience.
 */
export function useI18n() {
  const lang = useSyncExternalStore(subscribe, () => current);
  return {
    lang,
    t: (key: string, params?: Record<string, string | number>, fallback?: string) =>
      t(key, params, fallback),
    setLanguage: setAppLanguage,
  };
}
