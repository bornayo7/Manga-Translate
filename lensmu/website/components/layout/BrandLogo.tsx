import { cn } from '@/lib/utils';
export function BrandLogo({ className, inverse=false }: { className?: string; inverse?: boolean }) {
  return <span className={cn('brand-logo',inverse&&'brand-inverse',className)}><span className="brand-symbol" aria-hidden="true">lµ</span><span>lensmu</span></span>;
}
