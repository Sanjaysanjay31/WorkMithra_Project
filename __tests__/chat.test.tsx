import React from 'react';
import { render } from '@testing-library/react-native';
import ChatScreen from '../app/chat';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: '1' }),
}));
jest.mock('@/lib/storage', () => ({
  storage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() }
}));

describe('ChatScreen component', () => {
  it('should render correctly', () => {
    const { toJSON } = render(<ChatScreen />);
    expect(toJSON()).toBeDefined();
  });
});
