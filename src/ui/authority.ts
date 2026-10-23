/** ROLE-002: what each internal preset sees. Owners, administrators and project managers are the office. */
export const office = (role: string) => role === 'owner' || role === 'admin' || role === 'project_manager'
export const estimating = (role: string) => office(role) || role === 'estimator'
export const logging = (role: string) => office(role) || role === 'superintendent'
/** Estimator, superintendent and crew work inside a few job sections and never see the client's contract. */
export const limited = (role: string) => role === 'estimator' || role === 'superintendent' || role === 'crew' || role === 'bookkeeper' || role === 'reader'
