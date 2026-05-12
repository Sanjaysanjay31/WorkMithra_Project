import React from 'react';
import { render } from '@testing-library/react-native';
import HomePage from '../app/homePage';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: '1' }),
}));
jest.mock('@/lib/storage', () => ({
  storage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() }
}));

describe('HomePage component', () => {
  it('should render correctly', () => {
    const { toJSON } = render(<HomePage />);
    expect(toJSON()).toBeDefined();
  });
});
