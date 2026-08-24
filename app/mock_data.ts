// Shared types for worker dashboard data. All data comes from the backend
// (bookings + reviews); no sample/mock arrays live here anymore.

export type ReviewItem = { id: string; name: string; rating: number; date: string; text: string };
export type PastWorkItem = {
  id: string;
  place: string;
  description: string;
  date: string;
  rating: number;
  review: string;
  client_name: string;
  client_avatar?: string;
  payment: number;
  photo?: string;
};
