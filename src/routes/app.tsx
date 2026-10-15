import { createFileRoute } from '@tanstack/react-router'
import { HydrationUnit } from '../base/hydration/unit'
import { Workspace } from '../ui/workspace'
export const Route = createFileRoute('/app')({ component: () => <HydrationUnit><Workspace /></HydrationUnit> })
