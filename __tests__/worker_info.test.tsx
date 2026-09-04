import React from 'react';
import { render } from '@testing-library/react-native';
import WorkerInfo from '../app/worker_info';
import { authFetch } from '@/lib/api';
import { storage } from '@/lib/storage';

// Hoisted above the jest.mock factories below — parameters for the current
// screen, read by the mocked useLocalSearchParams.
const mockParams: Record<string, string> = { id: '1' };

jest.mock('expo-router', () => ({
  usePathname: () => '/',
  useFocusEffect: (cb: any) => { jest.requireActual<typeof import('react')>('react').useEffect(cb); },
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/lib/storage', () => ({
  storage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() }
}));
jest.mock('@/lib/api', () => ({
  authFetch: jest.fn(),
  readApiError: jest.fn(),
}));
jest.mock('@/lib/availability', () => ({
  listAvailability: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/lib/socket', () => ({
  ensureSocket: jest.fn(),
}));

function okResponse(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}

function seedResponses() {
  (authFetch as jest.Mock).mockImplementation(async (url: string) => {
    if (url.startsWith('/workers/')) {
      return okResponse({
        id: 1,
        full_name: 'Kanjit Sanjay',
        skill: 'Plumbing',
        rating: 4.5,
        phone: '+91 9999999999',
        profile_image: null,
        city: 'Hyderabad',
      });
    }
    // A job in `payment_proof_submitted` is NOT in job-history — only
    // completed jobs appear there. Empty history is what reproduces the bug:
    // the deep-linked booking must be injected or the review form never opens.
    if (url.startsWith('/job-history/')) return okResponse([]);
    if (url.startsWith('/reviews/')) return okResponse([]);
    return okResponse({});
  });
}

describe('WorkerInfo component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams.id = '1';
    delete mockParams.tab;
    delete mockParams.booking;
    (storage.get as jest.Mock).mockResolvedValue(null);
    seedResponses();
  });

  it('should render correctly', () => {
    const { toJSON } = render(<WorkerInfo />);
    expect(toJSON()).toBeDefined();
  });

  it('opens the review form for a deep-linked payment_proof_submitted booking even when job-history is empty', async () => {
    mockParams.tab = 'reviews';
    mockParams.booking = '99';
    const { findByText, queryByText } = render(<WorkerInfo />);

    // The synthetic reviewable row was injected, so the review form (stars,
    // text box, submit button) shows for the deep-linked booking…
    expect(await findByText(/Submit Review/)).toBeTruthy();
    // …and the "after a completed job" empty state must NOT be shown.
    expect(queryByText(/after a completed job/)).toBeNull();
  });

  it('shows the empty-state note on the reviews tab when there is nothing reviewable', async () => {
    mockParams.tab = 'reviews';
    const { findByText } = render(<WorkerInfo />);
    expect(await findByText(/after a completed job/)).toBeTruthy();
  });
});
