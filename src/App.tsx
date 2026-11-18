import { Suspense, useEffect } from 'react'
import { lazyPage as lazy, prefetchEditor } from '@/lib/chunkReload'
import { hasSession } from '@/lib/api'
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router'
import { StoreProvider, useStore } from '@/lib/store'
import Header from '@/components/Header'
import UtmCapture from '@/components/UtmCapture'
import CookieBanner from '@/components/CookieBanner'
import ScrollToTop from '@/components/ScrollToTop'
import BuildWatcher from '@/components/BuildWatcher'
import Footer from '@/components/Footer'
import EventTicker from '@/components/EventTicker'
import { I18nProvider } from '@/lib/i18n'
import SkipLink from '@/components/SkipLink'
import SeoManager from '@/components/SeoManager'
import LandingPage from '@/pages/LandingPage'

// Главная входит в исходный бандл: отдельный запрос за ней задерживал первую отрисовку.
// Остальные страницы — отдельными чанками, код редактора и админки не загружается заранее.
const Feed = lazy(() => import('@/pages/Feed'))
const HotPage = lazy(() => import('@/pages/HotPage'))
const CollectionsPage = lazy(() => import('@/pages/CollectionsPages').then((m) => ({ default: m.CollectionsPage })))
const CollectionPage = lazy(() => import('@/pages/CollectionsPages').then((m) => ({ default: m.CollectionPage })))
const ArticlePage = lazy(() => import('@/pages/ArticlePage'))
const CasePage = lazy(() => import('@/pages/CasePage'))
const CaseAnalyticsPage = lazy(() => import('@/pages/CaseAnalyticsPage'))
const CasesPage = lazy(() => import('@/pages/CasesPage'))
const SettingsLayout = lazy(() => import('@/pages/settings/SettingsLayout'))
const FeedSettingsPage = lazy(() => import('@/pages/settings/FeedSettingsPage'))
const HistorySettingsPage = lazy(() => import('@/pages/settings/HistorySettingsPage'))
const ImportSettingsPage = lazy(() => import('@/pages/settings/ImportSettingsPage'))
const ProfileSettingsPage = lazy(() => import('@/pages/settings/ProfileSettingsPage'))
const DraftsSettingsPage = lazy(() => import('@/pages/settings/DraftsSettingsPage'))
const AdPinsSettingsPage = lazy(() => import('@/pages/settings/AdPinsSettingsPage'))
const AppearanceSettingsPage = lazy(() => import('@/pages/settings/AppearanceSettingsPage'))
const LanguageSettingsPage = lazy(() => import('@/pages/settings/LanguageSettingsPage'))
const NotificationsSettingsPage = lazy(() => import('@/pages/settings/NotificationsSettingsPage'))
const JurySettingsPage = lazy(() => import('@/pages/settings/JurySettingsPage'))
const PayoutsSettingsPage = lazy(() => import('@/pages/settings/PayoutsSettingsPage'))
const ModerationSettingsPage = lazy(() => import('@/pages/settings/ModerationSettingsPage'))
const EditorSettingsPage = lazy(() => import('@/pages/settings/EditorSettingsPage'))
const LinkedAccountsSettingsPage = lazy(() => import('@/pages/settings/LinkedAccountsSettingsPage'))
const PasswordResetPage = lazy(() => import('@/pages/PasswordResetPage'))
const AdminCrawlerPage = lazy(() => import('@/pages/admin/AdminCrawlerPage'))
const AdminClaimsPage = lazy(() => import('@/pages/admin/AdminClaimsPage'))
const AdminTicketsPage = lazy(() => import('@/pages/admin/AdminTicketsPage'))
const AdminEmailPage = lazy(() => import('@/pages/admin/AdminEmailPage'))
const AdminPayoutsPage = lazy(() => import('@/pages/admin/AdminPayoutsPage'))
const AdminFinancePage = lazy(() => import('@/pages/admin/AdminFinancePage'))
const AdminLabelsPage = lazy(() => import('@/pages/admin/AdminLabelsPage'))
const AdminCooldownPage = lazy(() => import('@/pages/admin/AdminCooldownPage'))
const AdminSystemPage = lazy(() => import('@/pages/admin/AdminSystemPage'))
const CrawlerInfoPage = lazy(() => import('@/pages/CrawlerInfoPage'))
const AdminUsersPage = lazy(() => import('@/pages/admin/AdminUsersPage'))
const AtmospherePage = lazy(() => import('@/pages/AtmospherePage'))
const PremiumPage = lazy(() => import('@/pages/PremiumPage'))
const PurchaseReturnPage = lazy(() => import('@/pages/PurchaseReturnPage'))
const AfterPaymentsPage = lazy(() => import('@/pages/AfterPaymentsPage'))
const AuthCallbackPage = lazy(() => import('@/pages/AuthCallbackPage'))
const LegalDocPage = lazy(() => import('@/pages/legal/LegalPages').then((m) => ({ default: m.LegalDocPage })))
const LegalIndexPage = lazy(() => import('@/pages/legal/LegalPages').then((m) => ({ default: m.LegalIndexPage })))
const SecuritySettingsPage = lazy(() => import('@/pages/settings/SecuritySettingsPage'))
const DeveloperSettingsPage = lazy(() => import('@/pages/settings/DeveloperSettingsPage'))
const ComposePage = lazy(() => import('@/pages/ComposePage'))
const LoginPage = lazy(() => import('@/pages/LoginPage'))
const ApiDocsPage = lazy(() => import('@/pages/ApiDocsPage'))
const DocsPage = lazy(() => import('@/pages/DocsPage'))
const DesignPage = lazy(() => import('@/pages/DesignPage'))
const AdsPage = lazy(() => import('@/pages/AdsPage'))
const AdvertiserDashboardPage = lazy(() => import('@/pages/AdvertiserDashboardPage'))
const ProfilePage = lazy(() => import('@/pages/ProfilePage'))
const SupportPage = lazy(() => import('@/pages/SupportPage'))
const SupportContactPage = lazy(() => import('@/pages/SupportContactPage'))
const MyTicketsPage = lazy(() => import('@/pages/MyTicketsPage'))
const SupportLegalPage = lazy(() => import('@/pages/SupportLegalPage'))
const SharedDraftPage = lazy(() => import('@/pages/SharedDraftPage'))
const ArticleAnalyticsPage = lazy(() => import('@/pages/ArticleAnalyticsPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))

function CollectionRoute() {
  const { id } = useParams()
  return <CollectionPage id={id} />
}

/** Старые глобальные /settings* → scoped /profile/<handle>/settings/*; гостю — login с возвратом */
function LegacySettingsRedirect() {
  const { user } = useStore()
  const location = useLocation()
  if (!user) {
    return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} replace />
  }
  const sub = location.pathname.replace(/^\/settings/, '') || '/feed'
  return <Navigate to={`/profile/${user.handle}/settings${sub}`} replace />
}

/** только для вошедших: без сессии (или когда она кончилась) — на вход и обратно сюда же */
function RequireSession({ children }: { children: React.ReactNode }) {
  const { user } = useStore()
  const location = useLocation()
  if (!user || !hasSession()) {
    return <Navigate to={`/login?${new URLSearchParams({ returnTo: location.pathname + location.search })}`} replace />
  }
  return <>{children}</>
}

export default function App() {
  useEffect(() => {
    if (hasSession()) prefetchEditor()
  }, [])
  return (
    <StoreProvider>
      <I18nProvider>
      <div className="flex min-h-dvh flex-col">
        <SkipLink />
        <SeoManager />
        <Header />
        <EventTicker />
        <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
          <ScrollToTop />
        <BuildWatcher />
          <UtmCapture />
          <CookieBanner />
          <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center" role="status"><span className="meta animate-pulse">Загружаем страницу…</span></div>}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/feed" element={<Feed />} />
            <Route path="/atmosphere" element={<AtmospherePage />} />
            <Route path="/premium" element={<PremiumPage />} />
            <Route path="/hot" element={<HotPage />} />
            <Route path="/collections" element={<CollectionsPage />} />
            <Route path="/collection/:id" element={<CollectionRoute />} />
            <Route path="/article/:id" element={<ArticlePage />} />
            <Route path="/article/:id/analytics" element={<ArticleAnalyticsPage />} />
            <Route path="/case/:id" element={<CasePage />} />
            <Route path="/case/:id/analytics" element={<CaseAnalyticsPage />} />
            <Route path="/cases" element={<CasesPage />} />
            <Route path="/settings" element={<LegacySettingsRedirect />} />
            <Route path="/settings/*" element={<LegacySettingsRedirect />} />
            <Route path="/profile/:id/settings" element={<SettingsLayout />}>
              <Route index element={<Navigate to="feed" replace />} />
              <Route path="profile" element={<ProfileSettingsPage />} />
              <Route path="drafts" element={<DraftsSettingsPage />} />
              <Route path="feed" element={<FeedSettingsPage />} />
              <Route path="appearance" element={<AppearanceSettingsPage />} />
              <Route path="language" element={<LanguageSettingsPage />} />
              <Route path="notifications" element={<NotificationsSettingsPage />} />
              <Route path="history" element={<HistorySettingsPage />} />
              <Route path="editor" element={<EditorSettingsPage />} />
              <Route path="import" element={<ImportSettingsPage />} />
              <Route path="jury" element={<JurySettingsPage />} />
              <Route path="payouts" element={<PayoutsSettingsPage />} />
              <Route path="ad-pins" element={<AdPinsSettingsPage />} />
              <Route path="moderation" element={<ModerationSettingsPage />} />
              <Route path="accounts" element={<LinkedAccountsSettingsPage />} />
              <Route path="security" element={<SecuritySettingsPage />} />
              <Route path="developer" element={<DeveloperSettingsPage />} />
            </Route>
            <Route path="/compose" element={<RequireSession><ComposePage /></RequireSession>} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/login/reset" element={<PasswordResetPage />} />
            <Route path="/api" element={<ApiDocsPage />} />
            <Route path="/docs" element={<DocsPage />} />
            <Route path="/design" element={<DesignPage />} />
            <Route path="/ads" element={<AdsPage />} />
            <Route path="/ads/dashboard" element={<AdvertiserDashboardPage />} />
            <Route path="/profile/:id" element={<ProfilePage />} />
            <Route path="/admin/crawler" element={<AdminCrawlerPage />} />
            <Route path="/admin/claims" element={<AdminClaimsPage />} />
            <Route path="/admin/tickets" element={<AdminTicketsPage />} />
            <Route path="/admin/email" element={<AdminEmailPage />} />
            <Route path="/admin/payouts" element={<AdminPayoutsPage />} />
            <Route path="/admin/finance" element={<AdminFinancePage />} />
            <Route path="/admin/labels" element={<AdminLabelsPage />} />
            <Route path="/admin/cooldown" element={<AdminCooldownPage />} />
            <Route path="/admin/system" element={<AdminSystemPage />} />
            <Route path="/crawler" element={<CrawlerInfoPage />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/support" element={<SupportPage />} />
            <Route path="/support/contact" element={<SupportContactPage />} />
            <Route path="/support/tickets" element={<MyTicketsPage />} />
            <Route path="/support/legal" element={<SupportLegalPage />} />
            <Route path="/legal" element={<LegalIndexPage />} />
            <Route path="/purchase/:orderId" element={<PurchaseReturnPage />} />
            <Route path="/after-payments" element={<AfterPaymentsPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/admin" element={<Navigate to="/admin/tickets" replace />} />
            <Route path="/legal/:slug" element={<LegalDocPage />} />
            <Route path="/shared-draft/:token" element={<SharedDraftPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
          </Suspense>
        </main>
        <Footer />
      </div>
      </I18nProvider>
    </StoreProvider>
  )
}
