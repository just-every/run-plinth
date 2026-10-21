import type { Attachment, Job, Stamp } from './model'

export const handoverKinds = ['as-built', 'selection', 'manual', 'inspection', 'punch', 'warranty', 'final-cost', 'waiver'] as const
export type HandoverKind = typeof handoverKinds[number]
export interface HandoverRevision { id: string; revision: number; reference: string; file: Attachment; by: Stamp }
export interface HandoverDocument { id: string; title: string; kind: HandoverKind; tags: string[]; revisions: HandoverRevision[] }
export interface HandoverException { id: string; number: number; title: string; status: string; location: string; due_on: string; responsible: string }
export interface HandoverPackage {
 id: string; revision: number; title: string; digest: string; by: Stamp
 documents: { id: string; title: string; kind: HandoverKind; tags: string[]; source: HandoverRevision }[]
 exceptions: HandoverException[]; punch_results: { id: string; number: number; title: string; status: string; attempts: number }[]
 selection_references: { id: string; room: string; category: string; revision: number; specification: unknown }[]
 warranty_references: { id: string; snapshot: unknown }[]
 completion?: { statement: string; by: Stamp }
 acceptance?: { statement: string; exception_ids: string[]; by: Stamp }
}
export interface HandoverState { documents: HandoverDocument[]; packages: HandoverPackage[] }
export type HandoverJob = Job & { handover?: HandoverState }
export const handoverState = (job: HandoverJob): HandoverState => job.handover ?? { documents: [], packages: [] }
/** A release publishes only the reviewed immutable package, never the office document library. */
export function handoverClient(job: HandoverJob) { return { documents: [], packages: handoverState(job).packages.filter(p => p.completion) } }
