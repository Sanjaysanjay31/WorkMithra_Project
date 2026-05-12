export type ReviewItem = { id: string; name: string; rating: number; date: string; text: string };
export type PastWorkItem = {
  id: string;
  place: string;
  description: string;
  date: string;
  rating: number;
  review: string;
  client_name: string;
  client_avatar: string;
  payment: number;
  photo: string;
};

export const SAMPLE_REVIEWS: ReviewItem[] = [
  { id: 'r1', name: 'Ravi K.', rating: 5, date: '2026-04-22', text: 'Excellent work, on time and very polite. Will book again!' },
  { id: 'r2', name: 'Priya S.', rating: 4.5, date: '2026-03-15', text: 'Did the job neatly. Good value for money.' },
  { id: 'r3', name: 'Anil R.', rating: 4, date: '2026-02-10', text: 'Fixed the issue quickly. Communication could be better.' },
];

export const SAMPLE_PASTWORK: PastWorkItem[] = [
  {
    id: '1',
    place: 'Banjara Hills, Hyderabad',
    description: 'Bathroom plumbing repair — replaced pipes and fixed the leak.',
    date: '2026-04-22',
    rating: 4.8,
    review: 'Very professional and on time. Cleaned up afterwards too.',
    client_name: 'Ravi Kumar',
    client_avatar: 'https://i.pravatar.cc/100?img=12',
    payment: 1500,
    photo: 'https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?w=600&q=70',
  },
  {
    id: '2',
    place: 'Gachibowli, Hyderabad',
    description: 'Kitchen sink installation and tap replacement.',
    date: '2026-03-15',
    rating: 4.5,
    review: 'Good work, fair pricing. Would call again.',
    client_name: 'Priya Sharma',
    client_avatar: 'https://i.pravatar.cc/100?img=47',
    payment: 2200,
    photo: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=600&q=70',
  },
  {
    id: '3',
    place: 'Madhapur, Hyderabad',
    description: 'Water tank cleaning and motor servicing.',
    date: '2026-02-10',
    rating: 5.0,
    review: 'Excellent service, highly recommend! Very thorough.',
    client_name: 'Anil Reddy',
    client_avatar: 'https://i.pravatar.cc/100?img=33',
    payment: 1800,
    photo: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=600&q=70',
  },
];
