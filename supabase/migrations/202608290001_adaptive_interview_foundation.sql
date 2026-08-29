create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text,
  seniority text,
  summary text,
  narrative text,
  expertise jsonb not null default '[]'::jsonb,
  characteristics jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.source_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('cv', 'cover_letter')),
  file_name text,
  content text,
  storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.competencies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  relevance numeric not null default 0 check (relevance between 0 and 1),
  expected_level text not null check (expected_level in ('foundational', 'intermediate', 'senior', 'advanced')),
  estimated_level text check (estimated_level in ('foundational', 'intermediate', 'senior', 'advanced')),
  confidence numeric check (confidence between 0 and 1),
  last_practiced_at timestamptz,
  question_count integer not null default 0 check (question_count >= 0),
  average_score numeric,
  recent_score numeric,
  strengths jsonb not null default '[]'::jsonb,
  weaknesses jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.interview_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  exercise jsonb not null default '{}'::jsonb,
  result_summary jsonb not null default '{}'::jsonb,
  overall_score numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.interview_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.interview_sessions(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  category text not null,
  competency_id uuid references public.competencies(id) on delete set null,
  difficulty text not null check (difficulty in ('foundational', 'intermediate', 'senior', 'advanced')),
  is_follow_up boolean not null default false,
  prompt text not null,
  answer text,
  asked_at timestamptz,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.question_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references public.interview_questions(id) on delete cascade,
  overall_score numeric not null,
  dimensions jsonb not null default '{}'::jsonb,
  strengths jsonb not null default '[]'::jsonb,
  weaknesses jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hands_on_checkpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.interview_sessions(id) on delete cascade,
  code text not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index competencies_user_name_key on public.competencies (user_id, lower(name));
create index interview_sessions_user_created_idx on public.interview_sessions (user_id, created_at desc);
create unique index interview_questions_session_sequence_key on public.interview_questions (session_id, sequence);
create unique index question_evaluations_question_key on public.question_evaluations (question_id);
create index hands_on_checkpoints_session_created_idx on public.hands_on_checkpoints (session_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.source_documents enable row level security;
alter table public.competencies enable row level security;
alter table public.interview_sessions enable row level security;
alter table public.interview_questions enable row level security;
alter table public.question_evaluations enable row level security;
alter table public.hands_on_checkpoints enable row level security;

create policy select_own on public.profiles for select using (auth.uid() = user_id);
create policy insert_own on public.profiles for insert with check (auth.uid() = user_id);
create policy update_own on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy delete_own on public.profiles for delete using (auth.uid() = user_id);

create policy select_own on public.source_documents for select using (auth.uid() = user_id);
create policy insert_own on public.source_documents for insert with check (auth.uid() = user_id);
create policy update_own on public.source_documents for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy delete_own on public.source_documents for delete using (auth.uid() = user_id);

create policy select_own on public.competencies for select using (auth.uid() = user_id);
create policy insert_own on public.competencies for insert with check (auth.uid() = user_id);
create policy update_own on public.competencies for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy delete_own on public.competencies for delete using (auth.uid() = user_id);

create policy select_own on public.interview_sessions for select using (auth.uid() = user_id);
create policy insert_own on public.interview_sessions for insert with check (auth.uid() = user_id);
create policy update_own on public.interview_sessions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy delete_own on public.interview_sessions for delete using (auth.uid() = user_id);

create policy select_own on public.interview_questions for select using (auth.uid() = user_id);
create policy insert_own on public.interview_questions for insert with check (auth.uid() = user_id);
create policy update_own on public.interview_questions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy delete_own on public.interview_questions for delete using (auth.uid() = user_id);

create policy select_own on public.question_evaluations for select using (auth.uid() = user_id);
create policy insert_own on public.question_evaluations for insert with check (auth.uid() = user_id);
create policy update_own on public.question_evaluations for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy delete_own on public.question_evaluations for delete using (auth.uid() = user_id);

create policy select_own on public.hands_on_checkpoints for select using (auth.uid() = user_id);
create policy insert_own on public.hands_on_checkpoints for insert with check (auth.uid() = user_id);
create policy update_own on public.hands_on_checkpoints for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy delete_own on public.hands_on_checkpoints for delete using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('career-documents', 'career-documents', false);

create policy career_documents_select_own on storage.objects for select
using (bucket_id = 'career-documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy career_documents_insert_own on storage.objects for insert
with check (bucket_id = 'career-documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy career_documents_update_own on storage.objects for update
using (bucket_id = 'career-documents' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'career-documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy career_documents_delete_own on storage.objects for delete
using (bucket_id = 'career-documents' and (storage.foldername(name))[1] = auth.uid()::text);
