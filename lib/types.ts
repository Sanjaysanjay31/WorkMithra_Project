// Shared TypeScript types for backend API responses.
// These mirror the Pydantic response models in backend/schemas.py — keep them
// in sync when either side changes.

export interface UserBrief {
  id: number;
  full_name?: string | null;
  profile_image?: string | null;
}

export interface WorkerBrief {
  id: number;
  full_name?: string | null;
  skill?: string | null;
  hourly_rate?: number | null;
  rating?: number | null;
  profile_image?: string | null;
}

/** Mirrors WorkerResponse (backend/schemas.py). */
export interface WorkerResponse extends WorkerBrief {
  phone?: string | null;
  email?: string | null;
  age?: number | null;
  alternate_phone?: string | null;
  experience_years?: number | null;
  bio?: string | null;
  /** Free-text working hours, e.g. "Mon-Sat 9am-6pm". */
  timings?: string | null;
  availability?: boolean | null;
  current_status?: string | null;
  city?: string | null;
  pincode?: string | null;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  total_jobs?: number | null;
  completed_jobs?: number | null;
  aadhaar_verified?: boolean | null;
  created_at?: string | null;
  // Not returned by the backend — screens read these defensively as legacy
  // aliases and must not rely on them being present.
  alt_phone?: string | null;
  address?: string | null;
}

/** Mirrors BookingResponse (backend/schemas.py). Dates/times arrive as ISO strings. */
export interface BookingResponse {
  id: number;
  user_id: number;
  worker_id?: number | null;
  service_id?: number | null;
  booking_date?: string | null;
  booking_time?: string | null;
  status?: string | null;
  problem_description?: string | null;
  estimated_price?: number | null;
  final_price?: number | null;
  /**
   * Whose number is currently on the table while the booking is in price
   * negotiation: 'user' (the client's budget/counter) or 'worker' (the
   * worker's quote). final_price != null means the price is agreed & locked.
   * Null on legacy rows — treat as 'worker' (historically only workers quoted).
   */
  price_proposed_by?: 'user' | 'worker' | null;
  customer_address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  created_at?: string | null;
  user?: UserBrief | null;
  worker?: WorkerBrief | null;
}

/** Mirrors RatingReviewResponse. */
export interface ReviewResponse {
  id: number;
  booking_id?: number | null;
  user_id?: number | null;
  /** Present on GET /reviews/ responses (joined from the users table). */
  user_name?: string | null;
  worker_id?: number | null;
  rating: number;
  review_text?: string | null;
  /** Optional photo URL attached by the reviewer (single-image legacy field;
   * kept in sync with the first entry of review_images). */
  review_image?: string | null;
  /** Up to 5 image URLs attached to this review. */
  review_images?: string[] | null;
  created_at?: string | null;
}

/** Mirrors the dict returned by GET /job-history/. */
export interface JobHistoryResponse {
  id: number;
  booking_id?: number | null;
  worker_id?: number | null;
  user_id?: number | null;
  completion_notes?: string | null;
  completed_at?: string | null;
}

/** Mirrors ChatMessageResponse. */
export interface ChatMessageResponse {
  id: number;
  sender_id?: number | null;
  receiver_id?: number | null;
  booking_id?: number | null;
  message?: string | null;
  sent_at?: string | null;
}

/** Mirrors UserResponse. */
export interface UserProfileResponse {
  id: number;
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  profile_image?: string | null;
  role?: string | null;
  gender?: string | null;
  age?: number | null;
  address?: string | null;
  /** Free-form locality label shown on profiles. */
  location?: string | null;
  alternate_phone?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  // Not returned by the backend — screens read this defensively as a legacy
  // alias and must not rely on it being present.
  alt_phone?: string | null;
}

/** Completed job as shown on the worker dashboard (derived from bookings + reviews). */
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
  /** Agreed (final) price only — proposals the client never accepted are
   * not earnings, so the dashboard's total badge sums THIS field. */
  earned: number;
  photo?: string;
};
