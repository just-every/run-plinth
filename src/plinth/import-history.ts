import { Buffer } from 'node:buffer'
import { canonicalJson, sha256, type SourceBundle } from '../modules/import-kit/src/d1/index.ts'
import { need } from './model.ts'

type HistoricalRecord = { id: string; kind: string; occurredAt: string; description: string; fileIds: string[] }
type HistoricalFile = { id: string; name: string; mediaType: string; base64: string }
type HistoryJob = { externalId: string; records: HistoricalRecord[]; files: HistoricalFile[] }
export type HistoryEvidence = {
  records: (HistoricalRecord & { pointer: string; disposition: 'historical' | 'duplicate' | 'unsupported'; verified: false })[]
  files: { id: string; name?: string; mediaType?: string; sha256?: string; bytes?: number; artifact?: string; pointer: string; disposition: 'supplied' | 'missing'; outcome?: string; custody?: string }[]
}
const supported = new Set(['note', 'schedule', 'signed-change', 'invoice', 'payment', 'approval'])
const object = (value: unknown, keys: string[]): Record<string, unknown> => {
  need(value && typeof value === 'object' && !Array.isArray(value), 'Historical source entries must be objects')
  need(Object.keys(value).every(key => keys.includes(key)), 'Unsupported historical source field')
  return value as Record<string, unknown>
}
const text = (value: unknown, max = 200): string => {
  need(typeof value === 'string' && !!value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value), 'Provide bounded historical source text')
  return value
}
const array = (value: unknown, max: number): unknown[] => {
  need(Array.isArray(value) && value.length <= max, 'Historical source list exceeds its supported limit')
  return value
}
/** This is a documented owner-supplied sidecar, never a provider parser or a
 * claim that a historical signature or financial record is verified. */
export function attachImportHistory(source: SourceBundle, input: unknown): SourceBundle {
  if (input === undefined || input === '') return source
  need(typeof input === 'string' && Buffer.byteLength(input) <= 131072, 'Historical source JSON must be at most 128 KiB')
  let parsed: unknown
  try { parsed = JSON.parse(input) } catch { need(false, 'Historical source must be valid JSON') }
  const root = object(parsed, ['version', 'jobs'])
  need(root.version === 1, 'Unsupported historical source version')
  const ids = new Set(source.records.map(record => record.sourceId)), seen = new Set<string>()
  const artifacts = [...source.artifacts, { name: 'source-history.json', size: Buffer.byteLength(input), sha256: sha256(input), original: { status: 'available' as const, base64: Buffer.from(input).toString('base64') } }]
  const evidence = new Map<string, HistoryEvidence>()
  let totalFiles = 0
  for (const [jobIndex, raw] of array(root.jobs, 100).entries()) {
    const job = object(raw, ['externalId', 'records', 'files']) as unknown as HistoryJob
    const id = text(job.externalId)
    need(ids.has(id) && !seen.has(id), 'Historical source must name each supplied CSV job at most once')
    seen.add(id)
    const pointer = '/jobs/' + jobIndex
    const fileIds = new Set<string>(), files: HistoryEvidence['files'] = []
    for (const [index, rawFile] of array(job.files, 20).entries()) {
      const file = object(rawFile, ['id', 'name', 'mediaType', 'base64']) as unknown as HistoricalFile
      const fileId = text(file.id), name = text(file.name), mediaType = text(file.mediaType, 100)
      need(!fileIds.has(fileId), 'Duplicate historical file identifier')
      fileIds.add(fileId)
      need(typeof file.base64 === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64), 'Historical original must be canonical base64')
      const bytes = Buffer.from(file.base64, 'base64'); totalFiles += bytes.length
      need(bytes.length > 0 && totalFiles <= 65536, 'Historical originals must total at most 64 KiB')
      const artifact = 'history-file-' + jobIndex + '-' + index
      artifacts.push({ name: artifact, size: bytes.length, sha256: sha256(bytes), original: { status: 'available', base64: file.base64 } })
      files.push({ id: fileId, name, mediaType, bytes: bytes.length, sha256: sha256(bytes), artifact, pointer: pointer + '/files/' + index, disposition: 'supplied' })
    }
    const recordIds = new Map<string, string>(), records: HistoryEvidence['records'] = []
    for (const [index, rawRecord] of array(job.records, 100).entries()) {
      const record = object(rawRecord, ['id', 'kind', 'occurredAt', 'description', 'fileIds']) as unknown as HistoricalRecord
      const value = { id: text(record.id), kind: text(record.kind, 80), occurredAt: text(record.occurredAt, 40), description: text(record.description, 2000), fileIds: array(record.fileIds, 20).map(value => text(value)) }
      need(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value.occurredAt) && Number.isFinite(Date.parse(value.occurredAt)) && new Date(value.occurredAt).toISOString().replace('.000Z', 'Z') === value.occurredAt, 'Historical date must be a valid UTC timestamp')
      const prior = recordIds.get(value.id), hash = sha256(canonicalJson(value))
      need(!prior || prior === hash, 'Conflicting historical record identifiers')
      records.push({ ...value, pointer: pointer + '/records/' + index, disposition: prior ? 'duplicate' : supported.has(value.kind) ? 'historical' : 'unsupported', verified: false })
      recordIds.set(value.id, hash)
      for (const fileId of value.fileIds) if (!fileIds.has(fileId)) {
        files.push({ id: fileId, pointer: pointer + '/records/' + index + '/fileIds', disposition: 'missing' }); fileIds.add(fileId)
      }
    }
    evidence.set(id, { files, records })
  }
  return { ...source, artifacts, records: source.records.map(record => {
    const history = evidence.get(record.sourceId)
    if (!history) return record
    const payload = { ...record.payload as Record<string, any>, source_history: history, source_history_sha256: sha256(input) }
    return { ...record, payload, payloadHash: sha256(canonicalJson(payload)) }
  }) }
}
