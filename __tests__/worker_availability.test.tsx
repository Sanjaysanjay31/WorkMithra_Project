import React from 'react';
import { render } from '@testing-library/react-native';
import WorkerAvailabilityPage from '../app/worker_availability';
import { listAvailability, upsertAvailability } from '@/lib/availability';
import { storage } from '@/lib/storage';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({}),
}));
jest.mock('@/lib/storage', () => ({
  storage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() }
}));
jest.mock('@/lib/availability', () => ({
  listAvailability: jest.fn(),
  upsertAvailability: jest.fn(),
}));

const WID = 9;

function seedSession() {
  (storage.get as jest.Mock).mockImplementation(async (key: string) =>
    key === 'workmithra:auth' ? JSON.stringify({ id: WID, role: 'worker', token: 'tok' }) : null,
  );
}

describe('WorkerAvailabilityPage component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seedSession();
    (upsertAvailability as jest.Mock).mockResolvedValue(null);
  });

  it('should render correctly', () => {
    (listAvailability as jest.Mock).mockResolvedValue([]);
    const { toJSON } = render(<WorkerAvailabilityPage />);
    expect(toJSON()).toBeDefined();
  });

  it('shows all seven days of the week', async () => {
    (listAvailability as jest.Mock).mockResolvedValue([]);
    const { findByText } = render(<WorkerAvailabilityPage />);
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
      expect(await findByText(day)).toBeTruthy();
    }
  });

  it('renders saved slots from the server', async () => {
    (listAvailability as jest.Mock).mockResolvedValue([
      { id: 1, worker_id: WID, available_day: 'monday', start_time: '10:00', end_time: '16:00', is_available: true },
      { id: 2, worker_id: WID, available_day: 'tuesday', start_time: null, end_time: null, is_available: false },
    ]);
    const { findByText, findAllByText } = render(<WorkerAvailabilityPage />);
    // Monday's window is shown as 12h labels.
    expect(await findByText('10:00 AM')).toBeTruthy();
    expect(await findByText('4:00 PM')).toBeTruthy();
    expect(await findByText('Available 1 of 7 days')).toBeTruthy();
    // Unavailable days show the blocked note (6 of 7 days here).
    const blocked = await findAllByText('Not available — new bookings are blocked');
    expect(blocked.length).toBe(6);
  });
});
