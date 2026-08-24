// Screen-context knowledge for the AI assistant.
//
// Maps the current route to a human-readable screen name, a purpose sentence
// fed to the LLM, quick suggestion chips, and optional guided-onboarding
// steps. Kept out of components/ai-assistant.tsx so it can be tested and
// reused without pulling in React Native UI.

export type ScreenContext = {
  name: string;
  purpose: string;          // told to LLM
  suggestions: string[];    // quick chips
  onboardSteps?: Step[];    // trigger guided onboarding
};

export type Step =
  | { id: 'name'; q: string; key: 'full_name' }
  | { id: 'phone'; q: string; key: 'phone' }
  | { id: 'role'; q: string; key: 'role' }
  | { id: 'skill'; q: string; key: 'skill' }
  | { id: 'experience'; q: string; key: 'experience_years' }
  | { id: 'wage'; q: string; key: 'hourly_rate' }
  | { id: 'location'; q: string; key: 'location' }
  | { id: 'timings'; q: string; key: 'timings' };

export const REGISTRATION_STEPS: Step[] = [
  { id: 'name', q: 'What is your name?', key: 'full_name' },
  { id: 'phone', q: 'What is your mobile number?', key: 'phone' },
  { id: 'role', q: 'How would you like to use WorkMithra — User, Worker, or Both?', key: 'role' },
];

export const WORKER_STEPS: Step[] = [
  { id: 'skill', q: 'What work do you do?', key: 'skill' },
  { id: 'experience', q: 'How many years of experience do you have?', key: 'experience_years' },
  { id: 'wage', q: 'How much do you charge per hour in rupees?', key: 'hourly_rate' },
  { id: 'location', q: 'Which areas do you work in?', key: 'location' },
  { id: 'timings', q: 'What are your available timings?', key: 'timings' },
];

export function getScreenContext(pathname: string): ScreenContext {
  const p = (pathname || '').replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase();
  const segments = p.split('/').filter(Boolean);
  const current = segments[segments.length - 1] || 'home';
  const screenLabel = current
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'WorkMithra';

  const routeHints: Record<string, Partial<ScreenContext>> = {
    login: {
      name: 'Login',
      purpose: 'The user is on the login screen and may need help signing in or recovering access.',
      suggestions: ['How do I login?', 'I forgot my password', 'I am new — register me'],
    },
    register: {
      name: 'Register',
      purpose: 'The user is on the registration screen and may need help completing the form.',
      suggestions: ['Help me fill the form', 'I did not get the OTP', 'What does Verify OTP mean?'],
      onboardSteps: REGISTRATION_STEPS,
    },
    worker_profile: {
      name: 'Worker Profile',
      purpose: 'The user is editing worker profile details and may need help filling them in.',
      suggestions: ['Help me create profile', 'What domain should I pick?'],
      onboardSteps: WORKER_STEPS,
    },
    chat: {
      name: 'AI Translation Chat',
      purpose: 'The user is in live chat and may need help using voice or translation features.',
      suggestions: ['How do I send voice?', 'Change my language', 'Read this message aloud'],
    },
  };

  const hint = routeHints[current] || {};

  return {
    name: hint.name || screenLabel,
    purpose: hint.purpose || `The user is currently on the ${screenLabel} screen in the WorkMithra app. Help them clearly and briefly based on what they need right now.`,
    suggestions: hint.suggestions || ['What can I do here?', 'Help me with this page', 'How does this work?'],
    onboardSteps: hint.onboardSteps,
  };
}
