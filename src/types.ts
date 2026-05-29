export type Track = {
  id: string;
  title: string;
  url: string;
  webpageUrl: string;
  channel?: string;
  durationSeconds?: number;
  requestedBy: string;
};

export type TrackCandidate = {
  id?: string;
  title?: string;
  webpage_url?: string;
  url?: string;
  channel?: string;
  uploader?: string;
  channel_is_verified?: boolean;
  uploader_id?: string;
  duration?: number;
  live_status?: string;
  is_live?: boolean;
  availability?: string;
  description?: string;
};
