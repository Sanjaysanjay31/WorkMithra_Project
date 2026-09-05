import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import LoginScreen from '../app/login';

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  usePathname: () => '/',
  useFocusEffect: (cb: any) => { jest.requireActual<typeof import('react')>('react').useEffect(cb); },
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: '1' }),
}));

jest.mock('@/lib/storage', () => ({
  storage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() }
}));

describe('LoginScreen component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render login form with all inputs and role buttons', () => {
    const { getByPlaceholderText, getByText } = render(<LoginScreen />);
    
    expect(getByPlaceholderText('example@mail.com')).toBeTruthy();
    expect(getByPlaceholderText('Enter your password')).toBeTruthy();
    expect(getByText('User')).toBeTruthy();
    expect(getByText('Worker')).toBeTruthy();
    expect(getByText('Login')).toBeTruthy();
  });

  it('allows user to switch between User and Worker roles', () => {
    const { getByText } = render(<LoginScreen />);
    const workerButton = getByText('Worker');
    const userButton = getByText('User');

    fireEvent.press(workerButton);
    expect(workerButton).toBeTruthy();

    fireEvent.press(userButton);
    expect(userButton).toBeTruthy();
  });

  it('allows entering identifier and password', () => {
    const { getByPlaceholderText } = render(<LoginScreen />);
    const identifierInput = getByPlaceholderText('example@mail.com');
    const passwordInput = getByPlaceholderText('Enter your password');

    fireEvent.changeText(identifierInput, 'test@example.com');
    fireEvent.changeText(passwordInput, 'secret123');

    expect(identifierInput.props.value).toBe('test@example.com');
    expect(passwordInput.props.value).toBe('secret123');
  });
});

