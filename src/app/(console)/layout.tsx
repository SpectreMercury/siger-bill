import { AppShell } from '@/components/layout';

export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
