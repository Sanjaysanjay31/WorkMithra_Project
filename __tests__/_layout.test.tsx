import React from 'react';
import { render } from '@testing-library/react-native';
import RootLayout from '../app/_layout';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: '1' }),
}));
jest.mock('@/lib/storage', () => ({
  storage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() }
}));

describe('RootLayout component', () => {
  it('should render correctly', () => {
    const { toJSON } = render(<RootLayout />);
    expect(toJSON()).toBeDefined();
  });
});
