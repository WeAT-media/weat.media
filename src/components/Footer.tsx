import { Link } from 'react-router'
import { useStore } from '@/lib/store'
import { SOURCE_URL } from '@/config/site'
import BrandName from '@/components/BrandName'
import WheatMark from '@/components/WheatMark'
import { LEGAL_DOCS } from '@/pages/legal/documents'
import { reopenConsent } from '@/lib/consent'
import { useI18n } from '@/lib/i18n'

const col = 'flex flex-col gap-2 font-mono text-[12px] uppercase tracking-[0.08em] text-primary-foreground/70'
const link = 'transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function Footer() {
  const { cases, caseStats } = useStore()
  const { t } = useI18n()
  const open = cases.filter((c) => !caseStats(c).closed).length
  return (
    <footer className="bg-primary text-primary-foreground">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-5 py-12 md:flex-row md:items-start md:justify-between md:gap-10 md:px-8">
        <div>
          <WheatMark className="h-16 w-16" stemClass="text-primary-foreground" />
          <p className="mt-3 text-2xl font-extrabold tracking-tight"><BrandName accentClassName="text-primary-foreground" /></p>
          <p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-primary-foreground/70">{t('footerMission')}</p>
        </div>
        <nav aria-label={t('platform')} className={`${col} whitespace-nowrap`}>
          <span className="text-primary-foreground">{t('platform')}</span>
          <Link to="/feed" className={link}>{t('feed')}</Link>
          <Link to="/settings" className={link}>{t('moderation')}</Link>
          <Link to="/support" className={link}>{t('support')}</Link>
          <Link to="/atmosphere" className={link}>{t('atmosphere')}</Link>
          <a href="https://atproto.com/" target="_blank" rel="noopener noreferrer" className={link}>AT Protocol ↗</a>
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className={link}>{t('sourceCode')}</a>
          <span className="mt-2 text-primary-foreground/70">{t('openCases', open)}</span>
        </nav>
        <nav aria-label={t('partners')} className={`${col} whitespace-nowrap`}>
          <span className="text-primary-foreground">{t('partners')}</span>
          <Link to="/api" className={link}>API</Link>
          <Link to="/docs" className={link}>{t('documentation')}</Link>
          <Link to="/design" className={link}>{t('forDesigners')}</Link>
          <Link to="/ads" className={link}>{t('forAdvertisers')}</Link>
          <Link to="/ads/dashboard" className={link}>{t('advertiserDashboard')}</Link>
        </nav>
        <nav aria-label={t('legalInformation')} className={col}>
          <Link to="/legal" className={`${link} text-primary-foreground`}>{t('legalInformation')}</Link>
          {LEGAL_DOCS.map((d) => <Link key={d.slug} to={`/legal/${d.slug}`} className={link}>{d.title}</Link>)}
          <Link to="/support/legal" className={link}>{t('governmentRequests')}</Link>
          <button type="button" onClick={reopenConsent} className={`${link} cursor-pointer text-left uppercase`}>{t('cookieSettings')}</button>
        </nav>
      </div>
    </footer>
  )
}
