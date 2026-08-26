import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import BookingsPage from '../app/bookings';
import { authFetch, expectJson } from '@/lib/api';
import { storage } from '@/lib/storage';

jest.mock('expo-router', () => ({
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

const UID = 42;

function seedSession() {
  (storage.get as jest.Mock).mockImplementation(async (key: string) =>
    key === 'workmithra:auth' ? JSON.stringify({ id: UID, role: 'user', token: 'tok' }) : null,
  );
}

function seedBookings(list: unknown[]) {
  (authFetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
  (expectJson as jest.Mock).mockResolvedValue(list);
}

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    user_id: UID,
    worker_id: 9,
    booking_date: '2099-01-01',
    booking_time: '10:00',
    status: 'pending',
    estimated_price: null,
    final_price: null,
    price_proposed_by: null,
    worker: { id: 9, full_name: 'Ravi Kumar', skill: 'Plumber', rating: 4.5 },
    user: { id: UID, full_name: 'Client' },
    ...overrides,
  };
}

describe('BookingsPage component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seedSession();
  });

  it('should render correctly', () => {
    const { toJSON } = render(<BookingsPage />);
    expect(toJSON()).toBeDefined();
  });

  it('shows accept/counter actions when the worker has quoted', async () => {
    seedBookings([booking({ estimated_price: 500, price_proposed_by: 'worker' })]);
    const { findByText } = render(<BookingsPage />);
    expect(await findByText('Accept ₹500')).toBeTruthy();
    expect(await findByText('Counter')).toBeTruthy();
  });

  it('shows the agreed price once locked', async () => {
    seedBookings([booking({ estimated_price: 500, final_price: 500, price_proposed_by: 'worker' })]);
    const { findByText, queryByText } = render(<BookingsPage />);
    expect(await findByText('Agreed · ₹500')).toBeTruthy();
    expect(queryByText('Counter')).toBeNull();
  });

  it('shows a waiting chip while our own offer is on the table', async () => {
    seedBookings([booking({ estimated_price: 300, price_proposed_by: 'user' })]);
    const { findByText, queryByText } = render(<BookingsPage />);
    expect(await findByText('You offered ₹300 · waiting for reply')).toBeTruthy();
    expect(queryByText('Accept ₹300')).toBeNull();
  });

  it('invites a first proposal when no price exists yet', async () => {
    seedBookings([booking()]);
    const { findByText } = render(<BookingsPage />);
    expect(await findByText('Propose your price')).toBeTruthy();
  });
});
