import React from 'react';
import { render } from '@testing-library/react-native';
import WorkerDashboard from '../app/worker_dashboard';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: '1' }),
}));
jest.mock('@/lib/storage', () => ({
  storage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() }
}));

describe('WorkerDashboard component', () => {
  it('should render correctly', () => {
    const { toJSON } = render(<WorkerDashboard />);
    expect(toJSON()).toBeDefined();
  });
});
