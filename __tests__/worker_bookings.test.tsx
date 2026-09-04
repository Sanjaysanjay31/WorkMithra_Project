import React from 'react';
import { render } from '@testing-library/react-native';
import WorkerBookings from '../app/worker_bookings';
import { authFetch, expectJson } from '@/lib/api';
import { storage } from '@/lib/storage';

jest.mock('expo-router', () => ({
  usePathname: () => '/',
  useFocusEffect: (cb: any) => { jest.requireActual<typeof import('react')>('react').useEffect(cb); },
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: '1' }),
}));
jest.mock('@/lib/storage', () => ({
  storage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() }
}));
jest.mock('@/lib/api', () => ({
  authFetch: jest.fn(),
  expectJson: jest.fn(),
}));
jest.mock('@/lib/notifications', () => ({
  addNotification: jest.fn().mockResolvedValue(undefined),
}));

const WID = 9;

function seedSession() {
  (storage.get as jest.Mock).mockImplementation(async (key: string) =>
    key === 'workmithra:auth' ? JSON.stringify({ id: WID, role: 'worker', token: 'tok' }) : null,
  );
}

function seedBookings(list: unknown[]) {
  (authFetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
  (expectJson as jest.Mock).mockResolvedValue(list);
}

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    user_id: 42,
    worker_id: WID,
    booking_date: '2099-01-01',
    booking_time: '10:00',
    status: 'pending',
    estimated_price: null,
    final_price: null,
    price_proposed_by: null,
    worker: { id: WID, full_name: 'Worker' },
    user: { id: 42, full_name: 'Ananya Rao' },
    ...overrides,
  };
}

describe('WorkerBookings component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seedSession();
  });

  it('should render correctly', () => {
    const { toJSON } = render(<WorkerBookings />);
    expect(toJSON()).toBeDefined();
  });

  it('shows accept/counter when the client proposed a price', async () => {
    seedBookings([booking({ estimated_price: 400, price_proposed_by: 'user' })]);
    const { findByText } = render(<WorkerBookings />);
    expect(await findByText('Accept ₹400')).toBeTruthy();
    expect(await findByText('Counter')).toBeTruthy();
  });

  it('shows the agreed price once locked', async () => {
    seedBookings([booking({ estimated_price: 400, final_price: 400, price_proposed_by: 'user' })]);
    const { findByText, queryByText } = render(<WorkerBookings />);
    expect(await findByText('Agreed · ₹400')).toBeTruthy();
    expect(queryByText('Counter')).toBeNull();
  });

  it('shows a waiting chip for our own quote', async () => {
    seedBookings([booking({ estimated_price: 600, price_proposed_by: 'worker' })]);
    const { findByText } = render(<WorkerBookings />);
    expect(await findByText('You quoted ₹600 · waiting for client')).toBeTruthy();
  });

  it('invites a quote when no price exists yet', async () => {
    seedBookings([booking()]);
    const { findByText } = render(<WorkerBookings />);
    expect(await findByText('Send Quote')).toBeTruthy();
  });

  it('shows Accept/Decline only for a pending request', async () => {
    seedBookings([booking()]);
    const { findByText, queryByText } = render(<WorkerBookings />);
    expect(await findByText('Accept')).toBeTruthy();
    expect(await findByText('Decline')).toBeTruthy();
    expect(queryByText('Mark Work Complete')).toBeNull();
  });

  it('shows Mark Work Complete AND Mark not complete once the booking is accepted', async () => {
    seedBookings([booking({ status: 'upcoming' })]);
    const { findByText } = render(<WorkerBookings />);
    expect(await findByText('Mark Work Complete')).toBeTruthy();
    expect(await findByText('Mark not complete')).toBeTruthy();
  });

  it('shows the payment-proof state for a payment_proof_submitted booking and NEVER Accept/Decline', async () => {
    seedBookings([booking({ status: 'payment_proof_submitted' })]);
    const { findByText, queryByText } = render(<WorkerBookings />);
    expect(await findByText('Proof submitted · waiting for review')).toBeTruthy();
    expect(queryByText('Accept')).toBeNull();
    expect(queryByText('Decline')).toBeNull();
    expect(queryByText('Mark Work Complete')).toBeNull();
  });

  it('keeps a reported job in the Present tab until the client closes it', async () => {
    seedBookings([booking({ status: 'work_reported' })]);
    const { findByText, queryByText } = render(<WorkerBookings />);
    expect(await findByText('Waiting for client to preview & confirm')).toBeTruthy();
    expect(queryByText('Accept')).toBeNull();
    expect(queryByText('Decline')).toBeNull();
  });
});
