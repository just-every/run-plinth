import type { Job } from './model'

/** Search only the caller's projected jobs. Hidden values never affect matches or counts. */
export function searchJobs(projected: Job[], query: string) {
 const words = query.trim().toLocaleLowerCase('en-US')
 return projected.filter(job => {
  const text = [job.name, job.address, job.client_email, job.client_name,
   ...job.quotes.flatMap(quote => quote.lines.map(line => line.description)),
   ...job.schedules.map(task => task.description), ...job.diary.map(entry => entry.note),
   ...job.orders.map(order => order.description), ...job.variations.map(change => change.description),
  ].filter(Boolean).join('\n').toLocaleLowerCase('en-US')
  return text.includes(words)
 }).map(job => ({ id: job.id, name: job.name, address: job.address, job }))
}
