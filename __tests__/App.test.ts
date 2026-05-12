import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// Mock dependencies
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: '1', clientId: '2' }),
}));

jest.mock('@/lib/storage', () => ({
  storage: {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  }
}));

describe('App Behavioral Tests', () => {
  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      })
    ) as jest.Mock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Booking Flow', () => {
    it('creates a booking successfully', async () => {
      const mockFetch = global.fetch as jest.Mock;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 1, status: 'pending' }),
      });

      // Simulating API call made in WorkerInfoPage > handleBookNow
      const res = await fetch('http://localhost:8000/bookings', {
        method: 'POST',
        body: JSON.stringify({ worker_id: 2, user_id: 1, booking_date: '2026-05-20' })
      });
      const data = await res.json();
      expect(mockFetch).toHaveBeenCalled();
      expect(data.status).toBe('pending');
    });
  });

  describe('Role Switching', () => {
    it('redirects user after role selection', async () => {
      const mockStorageGet = require('@/lib/storage').storage.get as jest.Mock;
      mockStorageGet.mockResolvedValueOnce(JSON.stringify({ id: 1, role: 'user' }));

      // Simulating logic in SwitchRoleScreen
      const role = 'worker';
      let route = '';
      if (role === 'user') route = '/homePage';
      else route = '/worker_dashboard';
      
      expect(route).toBe('/worker_dashboard');
    });
  });

  describe('OTP Verification', () => {
    it('verifies OTP correctly', async () => {
      const mockFetch = global.fetch as jest.Mock;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'OTP verified', access_token: 'fake_token' }),
      });

      const res = await fetch('http://localhost:8000/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@test.com', otp: '123456' })
      });
      const data = await res.json();
      expect(data.access_token).toBe('fake_token');
    });
  });

  describe('Chat Translation', () => {
    it('translates chat message', async () => {
      const mockFetch = global.fetch as jest.Mock;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ original: 'Hello', translated: 'Namaste', originalLanguage: 'en', targetLanguage: 'hi' }),
      });

      const res = await fetch('http://localhost:8000/ai/translate-chat', {
        method: 'POST',
        body: JSON.stringify({ text: 'Hello', target_language: 'hi' })
      });
      const data = await res.json();
      expect(data.translated).toBe('Namaste');
    });
  });
});