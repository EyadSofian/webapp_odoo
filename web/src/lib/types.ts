export type UserKind = 'student' | 'instructor' | 'admin'

export interface SessionUser {
  partnerId: number
  name: string
  kind: UserKind
  email?: string | null
  lang: 'ar' | 'en'
}

export interface TokenResponse {
  accessToken: string
  expiresAt: string
  refreshToken: string
  user: SessionUser
}

export type SessionStatus = 'upcoming' | 'live' | 'ended' | 'cancelled'

export interface SessionSummary {
  id: number
  eventId: number
  eventTitle: string
  title: string
  number: number
  start: string | null
  end: string | null
  status: SessionStatus
  canJoin: boolean
  hasRecording: boolean
  documentCount: number
}

export interface LiveCourseCard {
  eventId: number
  title: string
  code: string | null
  courseChannelId: number | null
  instructor: { employeeId: number | null; name: string } | null
  mode: string
  start: string | null
  end: string | null
  sessionsTotal: number
  sessionsAttended: number
  attendancePercent: number
  accessUntil: string | null
  expired: boolean
  nextSession: SessionSummary | null
  role: 'student' | 'instructor'
}

export interface LiveCourseDetail {
  course: LiveCourseCard
  timeZone: string
  weekDays: string[]
  sessions: SessionSummary[]
}

export interface SessionDocument {
  id: number
  name: string
  extension: string | null
  size: string | null
}

export interface SessionDetail {
  session: SessionSummary
  recordingEmbedUrl: string | null
  recordingOnWebsiteOnly: boolean
  websiteUrl: string
  documents: SessionDocument[]
}

export interface RecordedCourseCard {
  channelId: number
  title: string
  summary: string | null
  completion: number
  status: string
  lessonsTotal: number
  totalHours: number
  accessUntil: string | null
  expired: boolean
  fromLiveCourse: boolean
  nextLessonId: number | null
}

export type LessonType = 'video' | 'document' | 'article' | 'infographic' | 'quiz' | 'certification'

export interface LessonItem {
  id: number
  title: string
  type: LessonType
  minutes: number
  completed: boolean
  isPreview: boolean
}

export interface LessonSection {
  id: number | null
  title: string
  lessons: LessonItem[]
}

export interface RecordedCourseDetail {
  course: RecordedCourseCard
  description: string | null
  sections: LessonSection[]
}

export interface LessonDetail {
  id: number
  channelId: number
  title: string
  type: LessonType
  minutes: number
  completed: boolean
  videoEmbedUrl: string | null
  html: string | null
  documentUrl: string | null
  hasFile: boolean
  websiteUrl: string | null
  previousLessonId: number | null
  nextLessonId: number | null
}

export interface Certificate {
  id: number
  title: string
  type: 'recorded' | 'attendance'
  number: string | null
  issuedAt: string | null
  score: number | null
}

export interface Home {
  name: string
  nextSession: SessionSummary | null
  upcoming: SessionSummary[]
  liveCourses: LiveCourseCard[]
  continueLearning: RecordedCourseCard[]
  certificateCount: number
  unreadNotifications: number
  unreadMessages: number
  websiteUrl: string
}

export interface Profile {
  partnerId: number
  name: string
  nameAr: string | null
  email: string | null
  phone: string | null
  kind: UserKind
  websiteUrl: string
}

export type MemberRole = 'student' | 'instructor' | 'assistant' | 'coordinator' | 'admin'

export interface MessageDto {
  id: number
  roomId: string
  sender: { partnerId: number; name: string; role: MemberRole }
  body: string
  replyTo: { id: number; senderName: string; snippet: string } | null
  attachments: { id: string; name: string; contentType: string; size: number }[]
  reactions: { emoji: string; partnerIds: number[] }[]
  isAnswer: boolean
  isPinned: boolean
  deleted: boolean
  createdAt: string
  clientId?: string | null
}

export interface RoomListItem {
  id: string
  kind: 'course' | 'question'
  title: string
  code: string | null
  eventId: number
  courseChannelId: number | null
  status: 'open' | 'readonly' | 'archived'
  announcementOnly: boolean
  myRole: MemberRole
  unreadCount: number
  lastMessage: { id: number; senderName: string; senderRole: MemberRole; text: string; at: string } | null
  lastMessageAt: string | null
  memberCount: number
}

export interface RoomDetail {
  id: string
  kind: 'course' | 'question'
  title: string
  code: string | null
  eventId: number
  courseChannelId: number | null
  status: 'open' | 'readonly' | 'archived'
  announcementOnly: boolean
  slowModeSeconds: number
  myRole: MemberRole
  mutedUntil: string | null
  lastReadMessageId: number
  memberCount: number
  askedBy: string | null
  pinned: MessageDto[]
}

export interface MemberDto {
  partnerId: number
  name: string
  role: MemberRole
  mutedUntil: string | null
}

export interface AppNotification {
  id: number
  kind: string
  title: string
  body: string
  url: string | null
  createdAt: string
  read: boolean
}

export interface Preferences {
  quietHoursEnabled: boolean
  quietFromMinute: number
  quietToMinute: number
  timeZone: string
}

// ---------------------------------------------------------------- assessments

export interface AssessmentCard {
  id: string
  kind: 'quiz' | 'task'
  title: string
  eventId: number
  trackId: number | null
  status: 'draft' | 'published' | 'closed'
  aiGenerated: boolean
  publishedAt: string | null
  dueAt: string | null
  questionCount: number
  maxAttempts: number
  passPercent: number
  mine: { attemptsUsed: number; bestPercent: number | null; passed: boolean } | null
  myTask: { submittedAt: string | null; grade: number | null; feedback: string | null } | null
  stats: { attempts: number; averagePercent: number | null; submissions: number; ungraded: number } | null
}

export interface OptionDto { id: string; text: string; isCorrect: boolean | null }
export interface QuestionDto { id: string; text: string; points: number; explanation: string | null; options: OptionDto[] }
export interface AttemptDto { id: string; submittedAt: string; score: number; maxScore: number; percent: number; passed: boolean }
export interface FileDto { id: string; name: string; contentType: string; size: number }
export interface SubmissionDto {
  id: string; partnerId: number; partnerName: string; text: string | null; submittedAt: string; late: boolean
  grade: number | null; feedback: string | null; files: FileDto[]
}

export interface AssessmentDetail {
  card: AssessmentCard
  instructions: string | null
  revealAnswers: boolean
  timeLimitMinutes: number | null
  isStaff: boolean
  questions: QuestionDto[]
  myAttempts: AttemptDto[]
  mySubmission: SubmissionDto | null
}

export interface AttemptResult {
  attemptId: string; score: number; maxScore: number; percent: number; passed: boolean; attemptsLeft: number
  review: { questionId: string; chosen: string | null; correct: string[] | null; isCorrect: boolean; explanation: string | null }[]
}

export interface LessonQuiz {
  slideId: number; channelId: number; title: string; completed: boolean; attempts: number
  questions: { id: number; text: string; answers: { id: number; text: string }[] }[]
}

export interface LessonQuizResult {
  completed: boolean; correct: number; total: number; attempts: number
  questions: { questionId: number; chosen: number | null; isCorrect: boolean; comment: string | null }[]
}
