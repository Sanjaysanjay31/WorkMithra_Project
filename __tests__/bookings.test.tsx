import React from 'react';
import { render } from '@testing-library/react-native';
import BookingsPage from '../app/bookings';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: '1' }),
}));
jest.mock('@/lib/storage', () => ({
  storage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() }
}));

describe('BookingsPage component', () => {
  it('should render correctly', () => {
    const { toJSON } = render(<BookingsPage />);
    expect(toJSON()).toBeDefined();
  });
});
