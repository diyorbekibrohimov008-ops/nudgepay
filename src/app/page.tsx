import { WorkspaceDashboard } from '@/components/WorkspaceDashboard';
import { workspaceService } from '@/lib/workspace-service';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const initialView = await workspaceService.getView();
  return <WorkspaceDashboard initialView={initialView} />;
}
