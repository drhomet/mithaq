import { Link, createFileRoute } from '@tanstack/react-router'
import { BookOpen, LayoutDashboard, Languages, ShieldCheck, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useHomeLabel } from '../auth-frame.tsx'
import { LocaleSwitch } from '../locale-switch.tsx'
import { loadEnterable } from '../screens.tsx'
import { useCopy } from './__root.tsx'

// A host file because it reads `loadEnterable`, which only a host file may.
export const Route = createFileRoute('/')({
  loader: () => loadEnterable(),
  component: Landing,
})

function EntryActions({ screens, size }: { screens: readonly { name: string; path: string }[] | null; size: 'sm' | 'lg' }) {
  const { t } = useCopy()
  const label = useHomeLabel()
  if (screens === null) {
    return (
      <>
        <Link to="/auth/sign-up">
          <Button size={size}>{t('marketing.getStarted', 'Get started')}</Button>
        </Link>
        <Link to="/auth/sign-in">
          <Button size={size} variant="outline">
            {t('auth.signIn', 'Sign in')}
          </Button>
        </Link>
      </>
    )
  }
  // A plain anchor: the path is the screen's own data, not a route the router knows.
  const home: { path: string; name?: string } = screens[0] ?? { path: '/unauthorized' }
  return (
    <a href={home.path}>
      <Button size={size}>{label(home, 'marketing.openScreen')}</Button>
    </a>
  )
}

function Feature({ icon: Icon, title, description }: { icon: typeof BookOpen; title: string; description: string }) {
  return (
    <Card>
      <CardHeader>
        <Icon className="mb-2 h-6 w-6 text-primary" />
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{description}</CardContent>
    </Card>
  )
}

function Step({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold">
        {number}
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

function Landing() {
  const { t, locale } = useCopy()
  const screens = Route.useLoaderData()?.screens ?? null
  // `t` answers `string | undefined` for a key no locale carries; the fallback only satisfies that type.
  const tt = (key: string, fallback: string) => t(key, fallback) ?? fallback
  const features = [
    { icon: BookOpen, title: tt('marketing.featureCoursesTitle', 'Courses and sessions'), description: tt('marketing.featureCoursesDescription', '') },
    { icon: Users, title: tt('marketing.featureEnrollmentsTitle', 'Enrollments'), description: tt('marketing.featureEnrollmentsDescription', '') },
    { icon: ShieldCheck, title: tt('marketing.featureRolesTitle', 'Roles and permissions'), description: tt('marketing.featureRolesDescription', '') },
    { icon: Languages, title: tt('marketing.featureBilingualTitle', 'Arabic and English, either direction'), description: tt('marketing.featureBilingualDescription', '') },
    { icon: LayoutDashboard, title: tt('marketing.featurePortalTitle', 'A dashboard and a customer portal'), description: tt('marketing.featurePortalDescription', '') },
  ]
  const steps = [
    { title: tt('marketing.howStep1Title', 'Set up your organization'), description: tt('marketing.howStep1Description', '') },
    { title: tt('marketing.howStep2Title', 'Add courses and roles'), description: tt('marketing.howStep2Description', '') },
    { title: tt('marketing.howStep3Title', 'Open the portal to your customers'), description: tt('marketing.howStep3Description', '') },
  ]
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6">
          <span className="text-lg font-semibold">{t('marketing.brand', 'Asas')}</span>
          <div className="flex items-center gap-1 sm:gap-2">
            <LocaleSwitch locale={locale} />
            <EntryActions screens={screens} size="sm" />
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-4 py-20 text-center sm:px-6 sm:py-28">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t('marketing.heroTitle', 'Run courses and enrollments without the busywork')}</h1>
          <p className="max-w-2xl text-lg text-muted-foreground">{t('marketing.heroSubtitle', '')}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <EntryActions screens={screens} size="lg" />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">{t('marketing.featuresTitle', 'Everything a training organization needs')}</h2>
            <p className="mt-3 text-muted-foreground">{t('marketing.featuresSubtitle', '')}</p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <Feature key={feature.title} {...feature} />
            ))}
          </div>
        </section>

        <section className="border-t bg-muted/30">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="mb-10 text-center text-3xl font-bold tracking-tight">{t('marketing.howTitle', 'How it works')}</h2>
            <div className="grid gap-8 sm:grid-cols-3">
              {steps.map((step, at) => (
                <Step key={step.title} number={at + 1} {...step} />
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 py-20 text-center sm:px-6">
          <h2 className="text-3xl font-bold tracking-tight">{t('marketing.ctaTitle', 'Start running your courses on Asas')}</h2>
          <p className="text-muted-foreground">{t('marketing.ctaSubtitle', '')}</p>
          <EntryActions screens={screens} size="lg" />
        </section>
      </main>

      <footer className="border-t py-8">
        <div className="mx-auto max-w-6xl px-4 text-center text-sm text-muted-foreground sm:px-6">
          {t('marketing.footer', 'Asas — courses and enrollments for training organizations.')}
        </div>
      </footer>
    </div>
  )
}
// mithaq-admin b06d8d335d306c07556f8f2b81fba20ba7ded198 32a4513d4cf4a984b7845056965d48edff53542ce962b466af67a87983832a6d
