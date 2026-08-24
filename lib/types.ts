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
  experience_years?: number | null;
  bio?: string | null;
  availability?: boolean | null;
  current_status?: string | null;
  city?: string | null;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  total_jobs?: number | null;
  completed_jobs?: number | null;
  aadhaar_verified?: boolean | null;
  created_at?: string | null;
  // Not in the current schema — screens read these defensively for forward
  // compatibility and must not rely on them being present.
  age?: number | null;
  alternate_phone?: string | null;
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

/**
 * Mirrors UserResponse. The optional `age` / `alternate_phone` / `location`
 * fields are not in the current schema — screens read them defensively for
 * forward compatibility and must not rely on them being present.
 */
export interface UserProfileResponse {
  id: number;
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  profile_image?: string | null;
  role?: string | null;
  gender?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  age?: number | null;
  alternate_phone?: string | null;
  location?: string | null;
}
