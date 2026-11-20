import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Lang = 'ar' | 'en'

const dict = {
  ar: {
    appName: 'إنجوسوفت',
    tagline: 'دوراتك ومحاضراتك ومجموعاتك في مكان واحد',
    home: 'الرئيسية', courses: 'دوراتي', chats: 'المجموعات', notifications: 'الإشعارات', profile: 'حسابي',
    email: 'البريد الإلكتروني', password: 'كلمة المرور', signIn: 'تسجيل الدخول', signingIn: 'جارٍ تسجيل الدخول…',
    forgot: 'نسيت كلمة المرور؟', notMember: 'لم تشترك بعد؟', browseWebsite: 'تصفّح الدورات على موقع إنجوسوفت',
    signInHint: 'سجّل الدخول بالبريد الإلكتروني وكلمة المرور الخاصين بحسابك على موقع إنجوسوفت.',
    signInTitle: 'سجّل الدخول إلى حسابك', showPassword: 'إظهار كلمة المرور', hidePassword: 'إخفاء كلمة المرور',
    loginKicker: 'منصة متدربي إنجوسوفت',
    loginHeadline: 'محاضراتك المباشرة وتسجيلاتها ومجموعة دورتك في مكان واحد',
    loginSub: 'ادخل المحاضرة من هاتفك، وشاهد ما فاتك، واسأل محاضرك داخل مجموعة الدورة.',
    loginDisciplines: 'كهرباء · عمارة · ميكانيكا · مواقع · إدارة مشاريع',
    appearance: 'المظهر', themeLight: 'فاتح', themeDark: 'داكن', themeSystem: 'تلقائي',
    hello: 'أهلًا', goodMorning: 'صباح الخير', goodEvening: 'مساء الخير',
    nextSession: 'محاضرتك القادمة', liveNow: 'مباشر الآن', joinNow: 'ادخل المحاضرة', startsIn: 'تبدأ بعد',
    joinOpensAt: 'يُتاح الدخول قبل الموعد بربع ساعة', noUpcoming: 'لا توجد محاضرات قادمة حاليًا',
    upcoming: 'المواعيد القادمة', continueLearning: 'تابع من حيث توقفت', myLiveCourses: 'دوراتك المباشرة',
    seeAll: 'عرض الكل', live: 'مباشر', recorded: 'مسجّل', liveCourses: 'دورات مباشرة', recordedCourses: 'دورات مسجّلة',
    sessions: 'المحاضرات', session: 'المحاضرة', group: 'المجموعة', about: 'عن الدورة',
    instructor: 'المحاضر', attendance: 'الحضور', progress: 'التقدّم', accessUntil: 'الصلاحية حتى',
    expired: 'انتهت الصلاحية', ended: 'انتهت', cancelled: 'أُلغيت', upcomingShort: 'قادمة',
    watchRecording: 'شاهد التسجيل', recording: 'التسجيل', files: 'الملفات', noFiles: 'لا توجد ملفات لهذه المحاضرة',
    recordingSoon: 'سيظهر التسجيل فور جاهزيته', download: 'تنزيل', open: 'فتح',
    lessons: 'دروس', hours: 'ساعة', minutes: 'دقيقة', continue: 'تابع', start: 'ابدأ', completed: 'مكتمل',
    markDone: 'تحديد كمكتمل', markedDone: 'تم ✓', next: 'التالي', previous: 'السابق',
    quizOnWebsite: 'يُجرى هذا الاختبار على موقع إنجوسوفت', openOnWebsite: 'افتحه على الموقع',
    certificates: 'شهاداتي', noCertificates: 'لا توجد شهادات بعد. أكمل دوراتك وستجدها هنا.',
    settings: 'الإعدادات', language: 'اللغة', logout: 'تسجيل الخروج', notificationsSettings: 'الإشعارات',
    enablePush: 'تفعيل الإشعارات', pushOn: 'الإشعارات مفعّلة', pushOff: 'الإشعارات متوقفة', pushBlocked: 'المتصفح يمنع الإشعارات',
    pushWhy: 'ليصلك تنبيه قبل المحاضرة، وعندما يرد عليك المحاضر.',
    quietHours: 'ساعات الهدوء', quietHoursHint: 'لا إشعارات ليلًا، باستثناء «بدأت المحاضرة».', testPush: 'إرسال إشعار تجريبي',
    installApp: 'ثبّت التطبيق', installWhy: 'ثبّته على الشاشة الرئيسية ليفتح بسرعة وتصلك الإشعارات.',
    installIos1: 'اضغط زر المشاركة', installIos2: 'اختر «إضافة إلى الشاشة الرئيسية»', installIos3: 'افتح إنجوسوفت من الشاشة الرئيسية وفعّل الإشعارات',
    install: 'تثبيت', later: 'لاحقًا',
    chatsEmpty: 'عند تسجيلك في دورة مباشرة، ستظهر مجموعتها هنا.', typeMessage: 'اكتب رسالة…', send: 'إرسال',
    announcementOnly: 'هذه المجموعة مخصصة للإعلانات حاليًا', readOnly: 'أُغلقت الكتابة في المجموعة بعد انتهاء الدورة',
    askPrivately: 'اطرح سؤالًا خاصًا على المحاضر', privateQuestion: 'سؤال خاص', members: 'الأعضاء', member: 'عضو',
    pinned: 'رسالة مثبتة', reply: 'رد', copy: 'نسخ', delete: 'حذف', pin: 'تثبيت', unpin: 'إلغاء التثبيت',
    markAnswer: 'اعتمادها إجابةً', unmarkAnswer: 'إلغاء الاعتماد', report: 'إبلاغ', reportSent: 'وصل البلاغ إلى فريق الدورة',
    messageDeleted: 'حُذفت الرسالة', instructorAnswer: 'إجابة معتمدة من المحاضر', typing: 'يكتب…', today: 'اليوم', yesterday: 'أمس',
    mute: 'كتم', muteHour: 'كتم ساعة', muteDay: 'كتم يوم', unmute: 'إلغاء الكتم', groupSettings: 'إعدادات المجموعة',
    announcementMode: 'وضع الإعلانات', slowMode: 'الوضع البطيء', off: 'متوقف',
    notifyAll: 'كل الرسائل', notifyImportant: 'المهم فقط (المحاضر والردود)', notifyNone: 'لا شيء', groupNotifications: 'إشعارات المجموعة',
    noNotifications: 'لا توجد إشعارات بعد.', markAllRead: 'تحديد الكل كمقروء',
    retry: 'أعد المحاولة', offline: 'أنت غير متصل الآن. سنتابع فور عودة الاتصال.',
    roleInstructor: 'المحاضر', roleAssistant: 'مساعد', roleCoordinator: 'المنسّق', roleAdmin: 'الإدارة', roleStudent: 'متدرب',
    online: 'عن بُعد', offlineRiyadh: 'حضوري · الرياض', offlineCairo: 'حضوري · القاهرة', offlineHq: 'حضوري',
    weekDays: 'أيام المحاضرات', code: 'الرمز', back: 'رجوع', close: 'إغلاق', loading: 'جارٍ التحميل…',
    renew: 'جدّد من الموقع', browseMore: 'دورات جديدة', website: 'موقع إنجوسوفت', support: 'الدعم',
    attachFile: 'إرفاق ملف', uploading: 'جارٍ الرفع…', newMessages: 'رسائل جديدة',
    sessionsDone: 'محاضرة منتهية', of: 'من',
    assessments: 'الاختبارات والمهام', quiz: 'اختبار', task: 'مهمة', pendingWork: 'بانتظارك',
    startQuiz: 'ابدأ الاختبار', retake: 'أعد المحاولة', submit: 'تسليم', submitAnswers: 'تسليم الإجابات', question: 'سؤال',
    attemptsLeft: 'محاولات متبقية', passMark: 'درجة النجاح', due: 'آخر موعد', passed: 'ناجح', notPassed: 'يحتاج إلى مراجعة',
    yourScore: 'درجتك', review: 'مراجعة الإجابات', correctAnswer: 'الإجابة الصحيحة', yourAnswer: 'إجابتك',
    draft: 'مسودة', published: 'منشور', closed: 'مغلق', publish: 'نشر', closeIt: 'إغلاق', save: 'حفظ', edit: 'تعديل',
    aiQuiz: 'اختبار بالذكاء الاصطناعي', aiQuizHint: 'سنكتب أسئلة من نص المحاضرة نفسها، وتراجعها أنت قبل النشر.', newQuiz: 'اختبار يدوي', newTask: 'مهمة جديدة',
    generating: 'جارٍ إعداد الأسئلة من المحاضرة…', questionsCount: 'عدد الأسئلة', difficulty: 'المستوى', easy: 'سهل', medium: 'متوسط', hard: 'صعب',
    addQuestion: 'أضف سؤالًا', addOption: 'أضف خيارًا', explanation: 'الشرح', title: 'العنوان', instructions: 'التعليمات',
    results: 'النتائج', submissions: 'التسليمات', grade: 'الدرجة', feedback: 'ملاحظاتك', gradeIt: 'اعتماد الدرجة', ungraded: 'بانتظار التصحيح',
    yourSubmission: 'تسليمك', writeAnswer: 'اكتب إجابتك…', attach: 'إرفاق ملفات', submitted: 'تم التسليم', late: 'متأخر', aiMade: 'بالذكاء الاصطناعي',
    noAssessments: 'لا توجد اختبارات أو مهام بعد.', chooseSession: 'اختر المحاضرة', allDone: 'أنجزت كل المطلوب منك 👏',
    checkAnswers: 'تحقّق', allCorrect: 'جميع الإجابات صحيحة، وسُجّل الدرس مكتملًا.', someWrong: 'بعض الإجابات تحتاج إلى مراجعة. أعد المحاولة.',
  },
  en: {
    appName: 'Engosoft',
    tagline: 'Your courses, sessions and groups in one place',
    home: 'Home', courses: 'My courses', chats: 'Groups', notifications: 'Notifications', profile: 'Account',
    email: 'Email', password: 'Password', signIn: 'Sign in', signingIn: 'Signing in…',
    forgot: 'Forgot password?', notMember: 'Not enrolled yet?', browseWebsite: 'Browse courses on engosoft.com',
    signInHint: 'Use the same email and password as your Engosoft website account.',
    signInTitle: 'Sign in to your account', showPassword: 'Show password', hidePassword: 'Hide password',
    loginKicker: 'Engosoft learner platform',
    loginHeadline: 'Your live sessions, their recordings and your course group in one place',
    loginSub: 'Join sessions from your phone, catch up on what you missed, and ask your instructor in the course group.',
    loginDisciplines: 'Electrical · Architecture · MEP · Site · Project management',
    appearance: 'Appearance', themeLight: 'Light', themeDark: 'Dark', themeSystem: 'Auto',
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
