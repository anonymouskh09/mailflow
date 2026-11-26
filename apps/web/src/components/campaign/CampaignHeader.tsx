import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { StatusPill } from '@/components/ui';

export function CampaignHeader({ name, status, meta, children }: { name: string; status: string; meta?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div>
      <Link to="/campaigns" className="inline-flex items-center gap-1 text-[13px] font-medium">
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        Campaigns
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-2xl font-bold">{name}</h1>
        <StatusPill status={status} />
        <span className="flex-auto text-[13px] text-muted">{meta}</span>
        {children}
      </div>
    </div>
  );
}
