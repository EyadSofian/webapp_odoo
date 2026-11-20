import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Lang = 'ar' | 'en'

const dict = {
  ar: {
    appName: 'إنجوسوفت',
    tagline: 'كورساتك ومحاضراتك وجروبك في مكان واحد',
    home: 'الرئيسية', courses: 'كورساتي', chats: 'الجروبات', notifications: 'الإشعارات', profile: 'حسابي',
    email: 'الإيميل', password: 'كلمة المرور', signIn: 'تسجيل الدخول', signingIn: 'بندخّلك…',
    forgot: 'نسيت كلمة المرور؟', notMember: 'لسه مش مشترك؟', browseWebsite: 'تصفّح الكورسات على موقع إنجوسوفت',
    signInHint: 'ادخل بنفس الإيميل وكلمة المرور بتوع حسابك على موقع إنجوسوفت.',
    hello: 'أهلاً', goodMorning: 'صباح الخير', goodEvening: 'مساء الخير',
    nextSession: 'محاضرتك الجاية', liveNow: 'مباشر الآن', joinNow: 'ادخل المحاضرة', startsIn: 'تبدأ بعد',
    joinOpensAt: 'الدخول يفتح قبلها بربع ساعة', noUpcoming: 'مفيش محاضرات جاية دلوقتي',
    upcoming: 'المواعيد الجاية', continueLearning: 'كمّل من حيث وقفت', myLiveCourses: 'كورساتك المباشرة',
    seeAll: 'الكل', live: 'مباشر', recorded: 'مسجّل', liveCourses: 'كورسات مباشرة', recordedCourses: 'كورسات مسجّلة',
    sessions: 'المحاضرات', session: 'المحاضرة', group: 'الجروب', about: 'عن الكورس',
    instructor: 'المحاضر', attendance: 'الحضور', progress: 'التقدّم', accessUntil: 'الصلاحية لحد',
    expired: 'انتهت الصلاحية', ended: 'انتهت', cancelled: 'اتلغت', upcomingShort: 'قادمة',
    watchRecording: 'شاهد التسجيل', recording: 'التسجيل', files: 'الملفات', noFiles: 'مفيش ملفات للمحاضرة دي',
    recordingSoon: 'التسجيل هيظهر أول ما يجهز', download: 'تحميل', open: 'فتح',
    lessons: 'دروس', hours: 'ساعة', minutes: 'دقيقة', continue: 'كمّل', start: 'ابدأ', completed: 'خلّصته',
    markDone: 'علّم إنه خلص', markedDone: 'تم ✓', next: 'التالي', previous: 'السابق',
    quizOnWebsite: 'الاختبار ده بيتحل على موقع إنجوسوفت', openOnWebsite: 'افتحه على الموقع',
    certificates: 'شهاداتي', noCertificates: 'مفيش شهادات لسه. كمّل كورساتك وهتلاقيها هنا.',
    settings: 'الإعدادات', language: 'اللغة', logout: 'تسجيل الخروج', notificationsSettings: 'الإشعارات',
    enablePush: 'فعّل الإشعارات', pushOn: 'الإشعارات شغالة', pushOff: 'الإشعارات مقفولة', pushBlocked: 'الإشعارات ممنوعة من المتصفح',
    pushWhy: 'عشان يوصلك تنبيه قبل المحاضرة، ولما المحاضر يرد عليك.',
    quietHours: 'ساعات الهدوء', quietHoursHint: 'مفيش إشعارات بالليل، ما عدا "المحاضرة بدأت".', testPush: 'جرّب إشعار',
    installApp: 'ثبّت التطبيق', installWhy: 'ثبّته على الشاشة الرئيسية عشان يفتح بسرعة وتوصلك الإشعارات.',
    installIos1: 'اضغط زرار المشاركة', installIos2: 'اختار "إضافة إلى الشاشة الرئيسية"', installIos3: 'افتح إنجوسوفت من الشاشة الرئيسية وفعّل الإشعارات',
    install: 'ثبّت', later: 'بعدين',
    chatsEmpty: 'لما تتسجّل في كورس مباشر، جروبه هيظهر هنا.', typeMessage: 'اكتب رسالة…', send: 'إرسال',
    announcementOnly: 'الجروب ده للإعلانات بس دلوقتي', readOnly: 'الجروب اتقفل للكتابة بعد انتهاء الكورس',
    askPrivately: 'اسأل المحاضر سؤال خاص', privateQuestion: 'سؤال خاص', members: 'الأعضاء', member: 'عضو',
    pinned: 'رسالة مثبتة', reply: 'رد', copy: 'نسخ', delete: 'مسح', pin: 'تثبيت', unpin: 'إلغاء التثبيت',
    markAnswer: 'اعتمدها كإجابة', unmarkAnswer: 'شيل الاعتماد', report: 'إبلاغ', reportSent: 'وصل البلاغ لفريق الكورس',
    messageDeleted: 'الرسالة اتمسحت', instructorAnswer: 'إجابة معتمدة من المحاضر', typing: 'بيكتب…', today: 'النهارده', yesterday: 'امبارح',
    mute: 'كتم', muteHour: 'كتم ساعة', muteDay: 'كتم يوم', unmute: 'إلغاء الكتم', groupSettings: 'إعدادات الجروب',
    announcementMode: 'وضع الإعلانات', slowMode: 'الوضع البطيء', off: 'مقفول',
    notifyAll: 'كل الرسايل', notifyImportant: 'المهم بس (المحاضر والردود)', notifyNone: 'مفيش', groupNotifications: 'إشعارات الجروب',
    noNotifications: 'مفيش إشعارات لسه.', markAllRead: 'علّم الكل كمقروء',
    retry: 'جرّب تاني', offline: 'إنت أوفلاين دلوقتي. هنكمّل أول ما النت يرجع.',
    roleInstructor: 'المحاضر', roleAssistant: 'مساعد', roleCoordinator: 'الكوردينيتور', roleAdmin: 'الإدارة', roleStudent: 'متدرب',
    online: 'أونلاين', offlineRiyadh: 'حضوري · الرياض', offlineCairo: 'حضوري · القاهرة', offlineHq: 'حضوري',
    weekDays: 'أيام المحاضرات', code: 'الكود', back: 'رجوع', close: 'إغلاق', loading: 'بنحمّل…',
    renew: 'جدّد من الموقع', browseMore: 'كورسات جديدة', website: 'موقع إنجوسوفت', support: 'الدعم',
    attachFile: 'إرفاق ملف', uploading: 'بيترفع…', newMessages: 'رسايل جديدة',
    sessionsDone: 'محاضرة خلصت', of: 'من',
    assessments: 'الاختبارات والتاسكات', quiz: 'اختبار', task: 'تاسك', pendingWork: 'مستنياك',
    startQuiz: 'ابدأ الاختبار', retake: 'حاول تاني', submit: 'سلّم', submitAnswers: 'سلّم الإجابات', question: 'سؤال',
    attemptsLeft: 'محاولات متبقية', passMark: 'درجة النجاح', due: 'آخر ميعاد', passed: 'ناجح', notPassed: 'محتاج تراجع',
    yourScore: 'درجتك', review: 'مراجعة الإجابات', correctAnswer: 'الإجابة الصحيحة', yourAnswer: 'إجابتك',
    draft: 'مسودة', published: 'منشور', closed: 'مقفول', publish: 'انشر', closeIt: 'اقفل', save: 'حفظ', edit: 'تعديل',
    aiQuiz: 'اختبار بالذكاء الاصطناعي', aiQuizHint: 'هنكتب أسئلة من نص المحاضرة نفسها، وانت تراجعها قبل النشر.', newQuiz: 'اختبار يدوي', newTask: 'تاسك جديد',
    generating: 'بنجهّز الأسئلة من المحاضرة…', questionsCount: 'عدد الأسئلة', difficulty: 'المستوى', easy: 'سهل', medium: 'متوسط', hard: 'صعب',
    addQuestion: 'ضيف سؤال', addOption: 'ضيف اختيار', explanation: 'الشرح', title: 'العنوان', instructions: 'التعليمات',
    results: 'النتائج', submissions: 'التسليمات', grade: 'الدرجة', feedback: 'ملاحظاتك', gradeIt: 'اعتمد الدرجة', ungraded: 'مستني تصحيح',
    yourSubmission: 'تسليمك', writeAnswer: 'اكتب إجابتك…', attach: 'ارفع ملفات', submitted: 'اتسلّم', late: 'متأخر', aiMade: 'بالذكاء الاصطناعي',
    noAssessments: 'مفيش اختبارات أو تاسكات لسه.', chooseSession: 'اختار المحاضرة', allDone: 'خلّصت كل المطلوب منك 👏',
    checkAnswers: 'صحّح', allCorrect: 'كل الإجابات صح، الدرس اتسجّل كمكتمل.', someWrong: 'في إجابات محتاجة مراجعة. جرّب تاني.',
  },
  en: {
    appName: 'Engosoft',
    tagline: 'Your courses, sessions and groups in one place',
    home: 'Home', courses: 'My courses', chats: 'Groups', notifications: 'Notifications', profile: 'Account',
    email: 'Email', password: 'Password', signIn: 'Sign in', signingIn: 'Signing in…',
    forgot: 'Forgot password?', notMember: 'Not enrolled yet?', browseWebsite: 'Browse courses on engosoft.com',
    signInHint: 'Use the same email and password as your Engosoft website account.',
    hello: 'Hello', goodMorning: 'Good morning', goodEvening: 'Good evening',
    nextSession: 'Your next session', liveNow: 'Live now', joinNow: 'Join session', startsIn: 'Starts in',
    joinOpensAt: 'Joining opens 15 minutes before', noUpcoming: 'No upcoming sessions',
    upcoming: 'Coming up', continueLearning: 'Continue learning', myLiveCourses: 'Your live courses',
    seeAll: 'All', live: 'Live', recorded: 'Recorded', liveCourses: 'Live courses', recordedCourses: 'Recorded courses',
    sessions: 'Sessions', session: 'Session', group: 'Group', about: 'About',
    instructor: 'Instructor', attendance: 'Attendance', progress: 'Progress', accessUntil: 'Access until',
    expired: 'Access ended', ended: 'Ended', cancelled: 'Cancelled', upcomingShort: 'Upcoming',
    watchRecording: 'Watch recording', recording: 'Recording', files: 'Files', noFiles: 'No files for this session',
    recordingSoon: 'The recording appears once it is ready', download: 'Download', open: 'Open',
    lessons: 'lessons', hours: 'h', minutes: 'min', continue: 'Continue', start: 'Start', completed: 'Completed',
    markDone: 'Mark as done', markedDone: 'Done ✓', next: 'Next', previous: 'Previous',
    quizOnWebsite: 'This quiz is taken on the Engosoft website', openOnWebsite: 'Open on website',
    certificates: 'My certificates', noCertificates: 'No certificates yet. Finish your courses to earn them.',
    settings: 'Settings', language: 'Language', logout: 'Sign out', notificationsSettings: 'Notifications',
    enablePush: 'Turn on notifications', pushOn: 'Notifications are on', pushOff: 'Notifications are off', pushBlocked: 'Notifications are blocked by the browser',
    pushWhy: 'Get a reminder before each session and when your instructor replies.',
    quietHours: 'Quiet hours', quietHoursHint: 'No notifications at night, except "session started".', testPush: 'Send a test',
    installApp: 'Install the app', installWhy: 'Add it to your home screen for quick access and notifications.',
    installIos1: 'Tap the Share button', installIos2: 'Choose "Add to Home Screen"', installIos3: 'Open Engosoft from your home screen and turn on notifications',
    install: 'Install', later: 'Later',
    chatsEmpty: 'When you join a live course, its group shows up here.', typeMessage: 'Write a message…', send: 'Send',
    announcementOnly: 'This group is announcements only for now', readOnly: 'This group closed after the course ended',
    askPrivately: 'Ask the instructor privately', privateQuestion: 'Private question', members: 'Members', member: 'member',
    pinned: 'Pinned message', reply: 'Reply', copy: 'Copy', delete: 'Delete', pin: 'Pin', unpin: 'Unpin',
    markAnswer: 'Approve as answer', unmarkAnswer: 'Remove approval', report: 'Report', reportSent: 'Report sent to the course team',
    messageDeleted: 'Message deleted', instructorAnswer: 'Approved by the instructor', typing: 'typing…', today: 'Today', yesterday: 'Yesterday',
    mute: 'Mute', muteHour: 'Mute 1 hour', muteDay: 'Mute 1 day', unmute: 'Unmute', groupSettings: 'Group settings',
    announcementMode: 'Announcements only', slowMode: 'Slow mode', off: 'Off',
    notifyAll: 'All messages', notifyImportant: 'Important only (instructor and replies)', notifyNone: 'None', groupNotifications: 'Group notifications',
    noNotifications: 'No notifications yet.', markAllRead: 'Mark all as read',
    retry: 'Try again', offline: 'You are offline. We will continue when you are back online.',
    roleInstructor: 'Instructor', roleAssistant: 'Assistant', roleCoordinator: 'Coordinator', roleAdmin: 'Admin', roleStudent: 'Learner',
    online: 'Online', offlineRiyadh: 'In person · Riyadh', offlineCairo: 'In person · Cairo', offlineHq: 'In person',
    weekDays: 'Session days', code: 'Code', back: 'Back', close: 'Close', loading: 'Loading…',
    renew: 'Renew on website', browseMore: 'New courses', website: 'Engosoft website', support: 'Support',
    attachFile: 'Attach file', uploading: 'Uploading…', newMessages: 'New messages',
    sessionsDone: 'sessions done', of: 'of',
    assessments: 'Quizzes and tasks', quiz: 'Quiz', task: 'Task', pendingWork: 'Waiting for you',
    startQuiz: 'Start quiz', retake: 'Try again', submit: 'Submit', submitAnswers: 'Submit answers', question: 'Question',
    attemptsLeft: 'attempts left', passMark: 'Pass mark', due: 'Due', passed: 'Passed', notPassed: 'Needs review',
    yourScore: 'Your score', review: 'Review answers', correctAnswer: 'Correct answer', yourAnswer: 'Your answer',
    draft: 'Draft', published: 'Published', closed: 'Closed', publish: 'Publish', closeIt: 'Close', save: 'Save', edit: 'Edit',
    aiQuiz: 'AI quiz', aiQuizHint: 'Questions are written from the session transcript; you review them before publishing.', newQuiz: 'Manual quiz', newTask: 'New task',
    generating: 'Writing questions from the session…', questionsCount: 'Questions', difficulty: 'Difficulty', easy: 'Easy', medium: 'Medium', hard: 'Hard',
    addQuestion: 'Add question', addOption: 'Add option', explanation: 'Explanation', title: 'Title', instructions: 'Instructions',
    results: 'Results', submissions: 'Submissions', grade: 'Grade', feedback: 'Feedback', gradeIt: 'Save grade', ungraded: 'To grade',
    yourSubmission: 'Your submission', writeAnswer: 'Write your answer…', attach: 'Attach files', submitted: 'Submitted', late: 'Late', aiMade: 'AI',
    noAssessments: 'No quizzes or tasks yet.', chooseSession: 'Choose a session', allDone: 'You are all caught up 👏',
    checkAnswers: 'Check', allCorrect: 'All correct. The lesson is marked as done.', someWrong: 'Some answers need another look. Try again.',
  },
} as const

export type Key = keyof (typeof dict)['ar']

interface I18n {
  lang: Lang
  dir: 'rtl' | 'ltr'
  t: (key: Key) => string
  setLang: (lang: Lang) => void
  locale: string
}

const Ctx = createContext<I18n | null>(null)

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('engosoft.lang')
    if (saved === 'ar' || saved === 'en') return saved
  } catch { /* ignore */ }
  return 'ar'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)
  const value = useMemo<I18n>(() => ({
    lang,
    dir: lang === 'ar' ? 'rtl' : 'ltr',
    t: (key) => dict[lang][key] ?? dict.ar[key],
    setLang: (l) => {
      setLangState(l)
      try { localStorage.setItem('engosoft.lang', l) } catch { /* ignore */ }
    },
    // Arabic text with Latin digits: clearer for times, codes and percentages.
    locale: lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB',
  }), [lang])

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = value.dir
  }, [lang, value.dir])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useI18n outside provider')
  return ctx
}
