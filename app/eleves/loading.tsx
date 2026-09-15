import {
  PageHeaderSkeleton,
  StatCardsSkeleton,
  TableSkeleton,
} from '@/components/loading-skeletons'

export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <PageHeaderSkeleton />
      <StatCardsSkeleton count={5} />
      <TableSkeleton />
    </div>
  )
}