'use client';

import { useState, FormEvent, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageSwitcher } from '@/components/language-switcher';
import { AlertCircle, Loader2, ArrowRight } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations();
  const { isAuthenticated, isLoading: authLoading, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // Wait for auth state to be loaded before checking
    if (!authLoading && isAuthenticated) {
      router.push('/');
    }
  }, [authLoading, isAuthenticated, router]);

  // Show loading while checking auth state
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // If already authenticated, show loading while redirecting
  if (isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login(email, password);
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.loginFailed'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-background">
      {/* Left side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-foreground relative overflow-hidden">
        {/* Geometric pattern background */}
        <div className="absolute inset-0 opacity-[0.03]">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
                <path d="M 60 0 L 0 0 0 60" fill="none" stroke="currentColor" strokeWidth="1" className="text-background"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-between p-12 text-background w-full">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t('common.appName')}</h1>
            <p className="text-sm opacity-60 mt-1">{t('common.appSubtitle')}</p>
          </div>

          <div className="space-y-8">
            <div>
              <h2 className="text-5xl font-light leading-tight">
                {t('login.hero.title1')}
                <br />
                <span className="font-semibold">{t('login.hero.title2')}</span>
                <br />
                {t('login.hero.title3')}
              </h2>
            </div>
            <p className="text-lg opacity-60 max-w-md">
              {t('login.hero.description')}
            </p>
          </div>

          <div className="flex items-center gap-6 text-sm opacity-40">
            <span>GCP</span>
            <span className="w-1 h-1 rounded-full bg-current" />
            <span>AWS</span>
            <span className="w-1 h-1 rounded-full bg-current" />
            <span>Azure</span>
            <span className="w-1 h-1 rounded-full bg-current" />
            <span>OpenAI</span>
          </div>
        </div>
      </div>

      {/* Right side - Login Form */}
      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between p-6">
          <div className="lg:hidden">
            <h1 className="text-xl font-bold">{t('common.appName')}</h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>

        {/* Form container */}
        <div className="flex-1 flex items-center justify-center px-6 pb-12">
          <div className="w-full max-w-sm space-y-8">
            {/* Header */}
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight">
                {t('auth.signIn')}
              </h2>
              <p className="text-muted-foreground text-sm">
                {t('auth.enterCredentials')}
              </p>
            </div>

            {/* Error Alert */}
            {error && (
              <Alert variant="destructive" className="border-destructive/50 bg-destructive/10">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="email" className="text-sm font-medium">
                    {t('auth.email')}
                  </label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="h-11 bg-transparent border-border/60 focus:border-foreground transition-colors"
                    required
                    autoComplete="email"
                    autoFocus
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="password" className="text-sm font-medium">
                    {t('auth.password')}
                  </label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="h-11 bg-transparent border-border/60 focus:border-foreground transition-colors"
                    required
                    autoComplete="current-password"
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-11 font-medium"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    {t('auth.continue')}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </form>

            {/* Demo Credentials */}
            <div className="pt-6 border-t border-border/40">
              <p className="text-xs text-muted-foreground mb-3">{t('auth.demoCredentials')}</p>
              <div className="space-y-1 font-mono text-xs text-muted-foreground">
                <p>
                  <span className="text-foreground/60">email:</span>{' '}
                  <span className="text-foreground">admin@sieger.cloud</span>
                </p>
                <p>
                  <span className="text-foreground/60">password:</span>{' '}
                  <span className="text-foreground">admin123</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom */}
        <div className="px-6 py-4 text-center text-xs text-muted-foreground">
          {t('auth.copyright')} &copy; {new Date().getFullYear()}
        </div>
      </div>
    </div>
  );
}
