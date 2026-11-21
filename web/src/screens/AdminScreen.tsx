import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  Bell, Check, Flag, History, Loader2, Lock, LogIn, MessagesSquare, Plus, Search, Send, Settings2, ShieldCheck, Trash2, Users, X,
} from 'lucide-react'
import { ApiError, api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { chatTime } from '../lib/format'
import { Avatar, EmptyState, ErrorState, Skeleton, TopBar, useToast } from '../components/ui'

// ------------------------------------------------------------------ types

interface Overview { users: number; active7: number; rooms: number; openReports: number; pushDevices: number }
interface AppUser { partnerId: number; name: string; kind: string; firstSeen: string; lastSeen: string; sessions: number; pushDevices: number }
interface AdminRow { partnerId: number; name: string; email: string | null; locked: boolean }
interface StaffHit { partnerId: number; name: string; login: string }
interface AdminRoom { id: string; title: string; code: string | null; eventId: number | null; status: string; announcementOnly: boolean; lastMessageAt: string | null; members: number; messages: number; openReports: number; joined: boolean }
interface Report { id: string; roomId: string; messageId: number; reason: string; roomTitle: string | null; reporter: string | null; at: string; resolvedAt: string | null; message: { body: string; deleted: boolean; sender: string; at: string } | null }
interface AuditRow { id: number; action: string; details: string | null; at: string; room: string | null; actor: string | null; target: string | null }
interface ChatSettings { studentsCanUpload: boolean; maxAttachmentMb: number; readOnlyAfterDays: number; burstMessages: number }

type Tab = 'users' | 'groups' | 'reports' | 'settings' | 'broadcast'

const AR = {
  title: 'لوحة الإدارة', users: 'المستخدمون', groups: 'المجموعات', reports: 'البلاغات', settings: 'الإعدادات', broadcast: 'إشعار جماعي',
  kUsers: 'مستخدمو التطبيق', kActive: 'نشطون خلال 7 أيام', kRooms: 'مجموعات الدورات', kReports: 'بلاغات مفتوحة', kPush: 'أجهزة الإشعارات',
  admins: 'مسؤولو الإدارة', addAdmin: 'إضافة مسؤول', searchStaff: 'ابحث عن موظف بالاسم أو البريد', fixed: 'من إعدادات الخادم', remove: 'إزالة',
  search: 'بحث', lastSeen: 'آخر دخول', sessions: 'جلسات', devices: 'أجهزة', noUsers: 'لا يوجد مستخدمون بعد',
  student: 'متدرب', instructor: 'محاضر', admin: 'إدارة',
  members: 'عضو', messages: 'رسالة', open: 'فتح', joinAsMod: 'دخول كمشرف', readOnly: 'للقراءة فقط', archived: 'مؤرشفة', announce: 'إعلانات فقط',
  openOnly: 'المفتوحة', all: 'الكل', deleteMsg: 'حذف الرسالة', dismiss: 'تجاهل البلاغ', resolved: 'تمت المعالجة', reportedBy: 'أبلغ', reason: 'السبب',
  noReports: 'لا توجد بلاغات مفتوحة', msgGone: 'الرسالة محذوفة', auditLog: 'سجل الإجراءات', system: 'النظام',
  sUpload: 'السماح للمتدربين برفع الملفات', sUploadHint: 'إذا أُغلق، يرفع فريق الدورة فقط الملفات في المجموعات.',
  sMaxMb: 'الحد الأقصى لحجم الملف (ميجابايت)', sReadOnly: 'تُغلق الكتابة في المجموعة بعد انتهاء الدورة بـ (يوم)', sBurst: 'أقصى عدد رسائل متتالية للمتدرب خلال 20 ثانية',
  save: 'حفظ', saved: 'تم الحفظ',
  audience: 'المستلمون', everyone: 'كل مستخدمي التطبيق', oneCourse: 'أعضاء دورة واحدة', chooseCourse: 'اختر الدورة', nTitle: 'العنوان', nBody: 'نص الإشعار',
  preview: 'معاينة', confirm: 'أؤكد إرسال هذا الإشعار', send: 'إرسال', sentTo: (n: number) => `أُرسل الإشعار إلى ${n} مستخدم`,
  everyoneHint: 'يصل إلى كل من سجّل الدخول إلى التطبيق خلال آخر 30 يومًا، في الإشعارات وعلى أجهزتهم.',
}
const EN: typeof AR = {
  title: 'Admin', users: 'Users', groups: 'Groups', reports: 'Reports', settings: 'Settings', broadcast: 'Broadcast',
  kUsers: 'App users', kActive: 'Active in 7 days', kRooms: 'Course groups', kReports: 'Open reports', kPush: 'Push devices',
  admins: 'Admins', addAdmin: 'Add admin', searchStaff: 'Search staff by name or email', fixed: 'Server setting', remove: 'Remove',
  search: 'Search', lastSeen: 'Last seen', sessions: 'sessions', devices: 'devices', noUsers: 'No users yet',
  student: 'Learner', instructor: 'Instructor', admin: 'Admin',
  members: 'members', messages: 'messages', open: 'Open', joinAsMod: 'Join as moderator', readOnly: 'Read-only', archived: 'Archived', announce: 'Announcements only',
  openOnly: 'Open', all: 'All', deleteMsg: 'Delete message', dismiss: 'Dismiss', resolved: 'Resolved', reportedBy: 'Reported by', reason: 'Reason',
  noReports: 'No open reports', msgGone: 'Message deleted', auditLog: 'Action log', system: 'System',
  sUpload: 'Learners can upload files', sUploadHint: 'When off, only the course team can upload files in groups.',
  sMaxMb: 'Maximum file size (MB)', sReadOnly: 'Groups turn read-only this many days after the course ends', sBurst: 'Most messages a learner can send in 20 seconds',
  save: 'Save', saved: 'Saved',
  audience: 'Audience', everyone: 'Everyone in the app', oneCourse: 'Members of one course', chooseCourse: 'Choose a course', nTitle: 'Title', nBody: 'Message',
  preview: 'Preview', confirm: 'I confirm sending this notification', send: 'Send', sentTo: (n: number) => `Sent to ${n} people`,
  everyoneHint: 'Reaches everyone signed in to the app in the last 30 days, in their inbox and on their devices.',
}

const ACTIONS_AR: Record<string, string> = {
  room_created: 'إنشاء مجموعة', member_added: 'إضافة عضو', member_removed: 'إزالة عضو', member_restored: 'إعادة عضو', role_changed: 'تغيير دور',
  question_opened: 'فتح سؤال خاص', message_deleted: 'حذف رسالة', message_reported: 'إبلاغ عن رسالة', pin_set: 'تثبيت رسالة', pin_cleared: 'إلغاء تثبيت',
  answer_set: 'اعتماد إجابة', answer_cleared: 'إلغاء اعتماد', announcement_on: 'تفعيل وضع الإعلانات', announcement_off: 'إيقاف وضع الإعلانات', slow_mode: 'الوضع البطيء',
  member_muted: 'كتم عضو', member_unmuted: 'إلغاء كتم', admin_added: 'إضافة مسؤول', admin_removed: 'إزالة مسؤول', admin_joined: 'دخول مسؤول كمشرف',
  report_message_deleted: 'حذف رسالة مُبلّغ عنها', report_dismissed: 'تجاهل بلاغ', settings_changed: 'تغيير الإعدادات', broadcast_sent: 'إرسال إشعار جماعي',
}

function useL() {
  const { lang } = useI18n()
  return lang === 'ar' ? AR : EN
}

const errText = (e: unknown) => (e instanceof ApiError ? e.message : String(e))

// ------------------------------------------------------------------ screen

export function AdminScreen() {
  const L = useL()
  const [params, setParams] = useSearchParams()
  const tab = (['users', 'groups', 'reports', 'settings', 'broadcast'].includes(params.get('tab') ?? '') ? params.get('tab') : 'users') as Tab
  const overview = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api<Overview>('/api/admin/overview') })

  const tabs: { id: Tab; label: string; icon: typeof Users; badge?: number }[] = [
    { id: 'users', label: L.users, icon: Users },
    { id: 'groups', label: L.groups, icon: MessagesSquare },
    { id: 'reports', label: L.reports, icon: Flag, badge: overview.data?.openReports },
    { id: 'settings', label: L.settings, icon: Settings2 },
    { id: 'broadcast', label: L.broadcast, icon: Bell },
  ]

  if (overview.error instanceof ApiError && overview.error.status === 403) {
    return (
      <div className="mx-auto max-w-3xl">
        <TopBar back title={L.title} />
        <div className="p-6"><EmptyState icon={<Lock className="h-7 w-7" />} title={overview.error.message} /></div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1280px]">
      <TopBar back="/profile" title={<span className="flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-accent" />{L.title}</span>} />

      <div className="space-y-5 px-4 py-4 md:px-8 md:py-6">
        {/* Numbers */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { v: overview.data?.users, l: L.kUsers },
            { v: overview.data?.active7, l: L.kActive },
            { v: overview.data?.rooms, l: L.kRooms },
            { v: overview.data?.openReports, l: L.kReports, tone: overview.data?.openReports ? 'text-live' : '' },
            { v: overview.data?.pushDevices, l: L.kPush },
          ].map((k, i) => (
            <div key={i} className="card px-4 py-3">
              {k.v === undefined ? <Skeleton className="h-8 w-14" /> : <p className={clsx('num text-[26px] font-bold leading-9', k.tone)}>{k.v}</p>}
              <p className="text-[13px] text-muted">{k.l}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0" role="tablist">
          {tabs.map(({ id, label, icon: Icon, badge }) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setParams({ tab: id }, { replace: true })}
              className={clsx('flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-[14px] font-semibold transition-colors',
                tab === id ? 'border-brand-500 bg-brand-500 text-white' : 'border-line bg-surface text-ink hover:bg-sunken')}>
              <Icon className="h-4 w-4" />{label}
              {!!badge && <span className={clsx('num rounded-full px-1.5 text-xs leading-5', tab === id ? 'bg-white/25' : 'bg-live text-white')}>{badge}</span>}
            </button>
          ))}
        </div>

        {tab === 'users' && <UsersTab />}
        {tab === 'groups' && <GroupsTab />}
        {tab === 'reports' && <ReportsTab />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'broadcast' && <BroadcastTab />}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ users and admins

function UsersTab() {
  const L = useL()
  const { lang } = useI18n()
  const [q, setQ] = useState('')
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api<AppUser[]>('/api/admin/users') })
  const list = useMemo(() => (users.data ?? []).filter((u) => !q.trim() || u.name.toLowerCase().includes(q.trim().toLowerCase())), [users.data, q])
  const kindLabel = (k: string) => (k === 'admin' ? L.admin : k === 'instructor' ? L.instructor : L.student)

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <section className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line p-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="field h-10 ps-9" placeholder={L.search} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <span className="num shrink-0 text-sm text-muted">{list.length}</span>
        </div>
        {users.error ? <ErrorState error={users.error} onRetry={() => users.refetch()} /> : null}
        {users.isLoading && <div className="space-y-2 p-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>}
        {users.data && list.length === 0 && <p className="p-6 text-center text-sm text-muted">{L.noUsers}</p>}
        <ul className="divide-y divide-line/70">
          {list.map((u) => (
            <li key={u.partnerId} className="flex items-center gap-3 px-4 py-3">
              <Avatar partnerId={u.partnerId} name={u.name} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold" dir="auto">{u.name}</p>
                <p className="truncate text-xs text-muted">
                  {L.lastSeen} <span className="num">{chatTime(u.lastSeen, lang)}</span> · <span className="num">{u.sessions}</span> {L.sessions} · <span className="num">{u.pushDevices}</span> {L.devices}
                </p>
              </div>
              <span className={clsx('chip shrink-0', u.kind === 'admin' ? 'bg-brand-500 text-white' : u.kind === 'instructor' ? 'bg-brand-50 text-accent' : 'bg-sunken text-muted')}>{kindLabel(u.kind)}</span>
            </li>
          ))}
        </ul>
      </section>
      <AdminsCard />
    </div>
  )
}

function AdminsCard() {
  const L = useL()
  const toast = useToast()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const admins = useQuery({ queryKey: ['admin', 'admins'], queryFn: () => api<AdminRow[]>('/api/admin/admins') })
  const hits = useQuery({ queryKey: ['admin', 'staff', q], queryFn: () => api<StaffHit[]>(`/api/admin/staff-search?q=${encodeURIComponent(q.trim())}`), enabled: q.trim().length >= 2 })
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['admin'] }) }
  const add = useMutation({ mutationFn: (partnerId: number) => api('/api/admin/admins', { method: 'POST', json: { partnerId } }), onSuccess: () => { setQ(''); refresh() }, onError: (e) => toast({ kind: 'error', text: errText(e) }) })
  const remove = useMutation({ mutationFn: (partnerId: number) => api(`/api/admin/admins/${partnerId}`, { method: 'DELETE' }), onSuccess: refresh, onError: (e) => toast({ kind: 'error', text: errText(e) }) })
  const ids = new Set(admins.data?.map((a) => a.partnerId))

  return (
    <section className="card lg:sticky lg:top-24">
      <h3 className="flex items-center gap-2 border-b border-line p-4 font-bold"><ShieldCheck className="h-5 w-5 text-accent" />{L.admins}</h3>
      {admins.isLoading && <div className="p-4"><Skeleton className="h-20 w-full" /></div>}
      <ul className="divide-y divide-line/70">
        {admins.data?.map((a) => (
          <li key={a.partnerId} className="flex items-center gap-3 px-4 py-3">
            <Avatar partnerId={a.partnerId} name={a.name} size={34} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold" dir="auto">{a.name}</p>
              <p className="truncate text-xs text-muted" dir="ltr">{a.locked ? L.fixed : a.email}</p>
            </div>
            {a.locked ? <Lock className="h-4 w-4 text-muted" />
              : a.partnerId !== user?.partnerId && (
                <button className="btn-ghost h-8 px-2 text-xs text-live" onClick={() => remove.mutate(a.partnerId)} disabled={remove.isPending}>{L.remove}</button>
              )}
          </li>
        ))}
      </ul>
      <div className="border-t border-line p-4">
        <p className="mb-2 text-sm font-semibold">{L.addAdmin}</p>
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="field h-10 ps-9 text-sm" placeholder={L.searchStaff} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {hits.isFetching && <Loader2 className="mx-auto mt-3 h-5 w-5 animate-spin text-muted" />}
        {hits.data && (
          <ul className="mt-2 space-y-1">
            {hits.data.map((h) => (
              <li key={h.partnerId} className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-sunken">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold" dir="auto">{h.name}</p>
                  <p className="truncate text-xs text-muted" dir="ltr">{h.login}</p>
                </div>
                {ids.has(h.partnerId)
                  ? <Check className="h-4 w-4 text-ok" />
                  : <button className="btn-soft h-8 px-3 text-xs" onClick={() => add.mutate(h.partnerId)} disabled={add.isPending}><Plus className="h-3.5 w-3.5" />{L.addAdmin}</button>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ groups

function GroupsTab() {
  const L = useL()
  const { lang } = useI18n()
  const toast = useToast()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const rooms = useQuery({ queryKey: ['admin', 'rooms'], queryFn: () => api<AdminRoom[]>('/api/admin/rooms') })
  const join = useMutation({
    mutationFn: (id: string) => api<{ roomId: string }>(`/api/admin/rooms/${id}/join`, { method: 'POST' }),
    onSuccess: ({ roomId }) => navigate(`/chats/${roomId}`),
    onError: (e) => toast({ kind: 'error', text: errText(e) }),
  })
  const list = useMemo(() => (rooms.data ?? []).filter((r) => !q.trim() || `${r.title} ${r.code ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())), [rooms.data, q])

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line p-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="field h-10 ps-9" placeholder={L.search} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="num shrink-0 text-sm text-muted">{list.length}</span>
      </div>
      {rooms.error ? <ErrorState error={rooms.error} onRetry={() => rooms.refetch()} /> : null}
      {rooms.isLoading && <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>}
      <ul className="divide-y divide-line/70">
        {list.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 md:flex-nowrap">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2">
                <span className="truncate text-[15px] font-semibold" dir="auto">{r.title}</span>
                {r.openReports > 0 && <span className="chip shrink-0 bg-live/10 text-live"><Flag className="h-3 w-3" /><span className="num">{r.openReports}</span></span>}
              </p>
              <p className="truncate text-xs text-muted">
                {r.code && <span className="num">{r.code} · </span>}
                <span className="num">{r.members}</span> {L.members} · <span className="num">{r.messages}</span> {L.messages}
                {r.lastMessageAt && <> · <span className="num">{chatTime(r.lastMessageAt, lang)}</span></>}
                {r.status !== 'open' && <> · {r.status === 'archived' ? L.archived : L.readOnly}</>}
                {r.announcementOnly && <> · {L.announce}</>}
              </p>
            </div>
            {r.joined
              ? <button className="btn-soft h-9 px-4 text-sm" onClick={() => navigate(`/chats/${r.id}`)}>{L.open}</button>
              : <button className="btn-ghost h-9 border border-line px-4 text-sm" onClick={() => join.mutate(r.id)} disabled={join.isPending}><LogIn className="h-4 w-4" />{L.joinAsMod}</button>}
          </li>
        ))}
      </ul>
    </section>
  )
}

// ------------------------------------------------------------------ reports and audit

function ReportsTab() {
  const L = useL()
  const { lang } = useI18n()
  const toast = useToast()
  const qc = useQueryClient()
  const [all, setAll] = useState(false)
  const reports = useQuery({ queryKey: ['admin', 'reports', all], queryFn: () => api<Report[]>(`/api/admin/reports${all ? '?all=true' : ''}`) })
  const audit = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => api<AuditRow[]>('/api/admin/audit') })
  const resolve = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'delete' | 'dismiss' }) => api(`/api/admin/reports/${id}/resolve`, { method: 'POST', json: { action } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin'] }) },
    onError: (e) => toast({ kind: 'error', text: errText(e) }),
  })

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
      <section className="space-y-3">
        <div className="flex w-fit rounded-xl bg-sunken p-1 text-sm font-semibold">
          {[{ v: false, l: L.openOnly }, { v: true, l: L.all }].map((o) => (
            <button key={String(o.v)} onClick={() => setAll(o.v)} className={clsx('h-8 rounded-lg px-4', all === o.v ? 'bg-surface shadow-card' : 'text-muted')}>{o.l}</button>
          ))}
        </div>
        {reports.error ? <ErrorState error={reports.error} onRetry={() => reports.refetch()} /> : null}
        {reports.isLoading && <Skeleton className="h-40 w-full" />}
        {reports.data && reports.data.length === 0 && <div className="card"><EmptyState icon={<Flag className="h-6 w-6" />} title={L.noReports} /></div>}
        {reports.data?.map((r) => (
          <article key={r.id} className={clsx('card p-4', r.resolvedAt && 'opacity-60')}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span className="font-semibold text-ink" dir="auto">{r.roomTitle}</span>
              <span className="num">{chatTime(r.at, lang)}</span>
            </div>
            <div className="mt-3 rounded-xl bg-sunken p-3">
              <p className="text-[13px] font-bold">{r.message?.sender}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-[15px]" dir="auto">{r.message?.deleted || !r.message ? <span className="italic text-muted">{L.msgGone}</span> : r.message.body || '📎'}</p>
            </div>
            <p className="mt-2 text-xs text-muted">{L.reportedBy}: <span className="font-semibold text-ink">{r.reporter ?? '—'}</span>{r.reason && <> · {L.reason}: <span dir="auto">{r.reason}</span></>}</p>
            {r.resolvedAt ? (
              <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-ok"><Check className="h-4 w-4" />{L.resolved}</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {!r.message?.deleted && (
                  <button className="btn h-9 bg-live/10 px-4 text-sm text-live hover:bg-live/20" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: r.id, action: 'delete' })}>
                    <Trash2 className="h-4 w-4" />{L.deleteMsg}
                  </button>
                )}
                <button className="btn-ghost h-9 border border-line px-4 text-sm" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: r.id, action: 'dismiss' })}>
                  <X className="h-4 w-4" />{L.dismiss}
                </button>
              </div>
            )}
          </article>
        ))}
      </section>

      <section className="card overflow-hidden lg:sticky lg:top-24">
        <h3 className="flex items-center gap-2 border-b border-line p-4 font-bold"><History className="h-5 w-5 text-accent" />{L.auditLog}</h3>
        {audit.isLoading && <div className="p-4"><Skeleton className="h-40 w-full" /></div>}
        <ul className="max-h-[70dvh] divide-y divide-line/70 overflow-y-auto">
          {audit.data?.map((a) => (
            <li key={a.id} className="px-4 py-2.5 text-[13px]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{lang === 'ar' ? (ACTIONS_AR[a.action] ?? a.action) : a.action.replace(/_/g, ' ')}</span>
                <span className="num shrink-0 text-[11px] text-muted">{chatTime(a.at, lang)}</span>
              </div>
              <p className="truncate text-muted" dir="auto">
                {a.actor ?? L.system}{a.target ? ` ← ${a.target}` : ''}{a.room ? ` · ${a.room}` : ''}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

// ------------------------------------------------------------------ settings

function SettingsTab() {
  const L = useL()
  const toast = useToast()
  const settings = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api<ChatSettings>('/api/admin/settings') })
  const [draft, setDraft] = useState<ChatSettings | null>(null)
  const s = draft ?? settings.data
  const save = useMutation({
    mutationFn: (body: ChatSettings) => api<ChatSettings>('/api/admin/settings', { method: 'PUT', json: body }),
    onSuccess: (d) => { setDraft(d); toast({ kind: 'ok', text: L.saved }) },
    onError: (e) => toast({ kind: 'error', text: errText(e) }),
  })
  if (settings.isLoading || !s) return <Skeleton className="h-64 w-full max-w-2xl" />
  const num = (k: keyof ChatSettings, min: number, max: number) => (
    <input type="number" min={min} max={max} className="field h-10 w-24 text-center num" value={Number(s[k])}
      onChange={(e) => setDraft({ ...s, [k]: Math.max(min, Math.min(max, Number(e.target.value) || min)) })} />
  )

  return (
    <section className="card max-w-2xl divide-y divide-line/70">
      <label className="flex cursor-pointer items-start gap-4 p-4">
        <input type="checkbox" className="mt-1 h-5 w-5 accent-[rgb(var(--brand-500))]" checked={s.studentsCanUpload}
          onChange={(e) => setDraft({ ...s, studentsCanUpload: e.target.checked })} />
        <span><span className="block font-semibold">{L.sUpload}</span><span className="block text-sm text-muted">{L.sUploadHint}</span></span>
      </label>
      <div className="flex items-center justify-between gap-4 p-4"><span className="font-semibold">{L.sMaxMb}</span>{num('maxAttachmentMb', 1, 25)}</div>
      <div className="flex items-center justify-between gap-4 p-4"><span className="font-semibold">{L.sReadOnly}</span>{num('readOnlyAfterDays', 0, 365)}</div>
      <div className="flex items-center justify-between gap-4 p-4"><span className="font-semibold">{L.sBurst}</span>{num('burstMessages', 3, 30)}</div>
      <div className="flex justify-end p-4">
        <button className="btn-primary h-10 px-6" disabled={!draft || save.isPending} onClick={() => draft && save.mutate(draft)}>
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{L.save}
        </button>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ broadcast

function BroadcastTab() {
  const L = useL()
  const toast = useToast()
  const rooms = useQuery({ queryKey: ['admin', 'rooms'], queryFn: () => api<AdminRoom[]>('/api/admin/rooms') })
  const [audience, setAudience] = useState<'all' | 'course'>('all')
  const [eventId, setEventId] = useState<number | ''>('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [sure, setSure] = useState(false)
  const course = rooms.data?.find((r) => r.eventId === eventId)
  const send = useMutation({
    mutationFn: () => api<{ sent: number }>('/api/admin/broadcast', { method: 'POST', json: { title, body, audience, eventId: audience === 'course' ? eventId : null } }),
    onSuccess: ({ sent }) => { toast({ kind: 'ok', text: L.sentTo(sent) }); setTitle(''); setBody(''); setSure(false) },
    onError: (e) => toast({ kind: 'error', text: errText(e) }),
  })
  const ready = title.trim().length >= 3 && body.trim().length >= 3 && (audience === 'all' || !!eventId) && sure

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
      <section className="card space-y-5 p-4 md:p-6">
        <div>
          <p className="mb-2 text-sm font-semibold">{L.audience}</p>
          <div className="flex flex-wrap gap-2">
            {([['all', L.everyone], ['course', L.oneCourse]] as const).map(([v, l]) => (
              <button key={v} onClick={() => setAudience(v)}
                className={clsx('h-10 rounded-full border px-4 text-sm font-semibold transition-colors', audience === v ? 'border-brand-500 bg-brand-50 text-accent' : 'border-line hover:bg-sunken')}>{l}</button>
            ))}
          </div>
          {audience === 'all' && <p className="mt-2 text-xs text-muted">{L.everyoneHint}</p>}
          {audience === 'course' && (
            <select className="field mt-3 h-11" value={eventId} onChange={(e) => setEventId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">{L.chooseCourse}</option>
              {rooms.data?.filter((r) => r.eventId && r.status !== 'archived').map((r) => (
                <option key={r.id} value={r.eventId!}>{r.title}{r.code ? ` · ${r.code}` : ''} ({r.members})</option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label className="mb-2 block text-sm font-semibold" htmlFor="b-title">{L.nTitle}</label>
          <input id="b-title" className="field h-11" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} dir="auto" />
        </div>
        <div>
          <label className="mb-2 block text-sm font-semibold" htmlFor="b-body">{L.nBody}</label>
          <textarea id="b-body" className="field min-h-[120px] py-3" maxLength={500} value={body} onChange={(e) => setBody(e.target.value)} dir="auto" />
          <p className="num mt-1 text-end text-xs text-muted">{body.length}/500</p>
        </div>
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--brand-500))]" checked={sure} onChange={(e) => setSure(e.target.checked)} />
          {L.confirm}{audience === 'course' && course ? ` (${course.members} ${L.members})` : ''}
        </label>
        <button className="btn-primary h-11 px-6" disabled={!ready || send.isPending} onClick={() => send.mutate()}>
          {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 rtl:rotate-180" />}{L.send}
        </button>
      </section>

      <aside className="lg:sticky lg:top-24">
        <p className="mb-2 text-sm font-semibold text-muted">{L.preview}</p>
        <div className="flex items-start gap-3 rounded-[18px] border border-line bg-surface p-4 shadow-card">
          <img src="/icon-192.png" alt="" className="h-10 w-10 rounded-xl" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold" dir="auto">{title || L.nTitle}</p>
            <p className="line-clamp-3 text-sm text-muted" dir="auto">{body || L.nBody}</p>
          </div>
        </div>
      </aside>
    </div>
  )
}
