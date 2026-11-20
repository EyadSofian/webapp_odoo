import { StrictMode, lazy, useEffect, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Navigate, Outlet, RouterProvider, createBrowserRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { registerSW } from 'virtual:pwa-register'
import { ApiError } from './lib/api'
import { AuthProvider, useAuth } from './lib/auth'
import { I18nProvider, useI18n } from './lib/i18n'
import { ToastProvider, useToast } from './components/ui'
import { AppShell } from './components/AppShell'
import { LoginScreen } from './screens/LoginScreen'
import { HomeScreen } from './screens/HomeScreen'
import { ChatsLayout, ChatsPlaceholder } from './screens/ChatsScreen'
import './index.css'

// Screens load on first visit, so the first paint on a phone only downloads what it shows.
const CoursesScreen = lazy(() => import('./screens/CoursesScreen').then((m) => ({ default: m.CoursesScreen })))
const LiveCourseScreen = lazy(() => import('./screens/LiveCourseScreen').then((m) => ({ default: m.LiveCourseScreen })))
const SessionScreen = lazy(() => import('./screens/SessionScreen').then((m) => ({ default: m.SessionScreen })))
const RecordedCourseScreen = lazy(() => import('./screens/RecordedCourseScreen').then((m) => ({ default: m.RecordedCourseScreen })))
const LessonScreen = lazy(() => import('./screens/LessonScreen').then((m) => ({ default: m.LessonScreen })))
const ChatRoomScreen = lazy(() => import('./screens/ChatRoomScreen').then((m) => ({ default: m.ChatRoomScreen })))
const NotificationsScreen = lazy(() => import('./screens/NotificationsScreen').then((m) => ({ default: m.NotificationsScreen })))
const ProfileScreen = lazy(() => import('./screens/ProfileScreen').then((m) => ({ default: m.ProfileScreen })))
const CertificatesScreen = lazy(() => import('./screens/CertificatesScreen').then((m) => ({ default: m.CertificatesScreen })))
const AssessmentScreen = lazy(() => import('./screens/AssessmentScreen').then((m) => ({ default: m.AssessmentScreen })))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (count, error) => !(error instanceof ApiError && [401, 403, 404, 422].includes(error.status)) && count < 2,
    },
  },
})

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <>{children}</>
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  return user ? <Navigate to="/" replace /> : <>{children}</>
}

/** Offers the new version when one is deployed, instead of switching under the learner's feet. */
function UpdatePrompt() {
  const toast = useToast()
  const { lang } = useI18n()
  useEffect(() => {
    const update = registerSW({
      onNeedRefresh() {
        toast({ kind: 'info', text: lang === 'ar' ? 'في نسخة جديدة من التطبيق' : 'A new version is ready', action: { label: lang === 'ar' ? 'حدّث' : 'Update', run: () => update(true) } })
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

function Root() {
  return (
    <>
      <UpdatePrompt />
      <Outlet />
    </>
  )
}

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/login', element: <GuestOnly><LoginScreen /></GuestOnly> },
      {
        element: <RequireAuth><AppShell /></RequireAuth>,
        children: [
          { path: '/', element: <HomeScreen /> },
          { path: '/courses', element: <CoursesScreen /> },
          { path: '/live/:eventId', element: <LiveCourseScreen /> },
          { path: '/sessions/:trackId', element: <SessionScreen /> },
          { path: '/recorded/:channelId', element: <RecordedCourseScreen /> },
          { path: '/lessons/:slideId', element: <LessonScreen /> },
          {
            path: '/chats',
            element: <ChatsLayout />,
            children: [
              { index: true, element: <ChatsPlaceholder /> },
              { path: ':roomId', element: <ChatRoomScreen /> },
            ],
          },
          { path: '/assessments/:id', element: <AssessmentScreen /> },
          { path: '/notifications', element: <NotificationsScreen /> },
          { path: '/profile', element: <ProfileScreen /> },
          { path: '/certificates', element: <CertificatesScreen /> },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ToastProvider>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
)
