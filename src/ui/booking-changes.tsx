import { Action, Field, Form } from './shared'
import type { JobProps } from './job'
import type { Schedule } from '../plinth/model'

const localInput = (value: string) => {
  const d = new Date(value)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
export function BookingChanges({ booking, mutate }: Pick<JobProps, 'mutate'> & { booking: Schedule }) {
  return <section className="side-section"><h3>Change booked work</h3>
    <Form key={booking.id + ':' + booking.revision} submit="Approve new dates" reset={false} action={async f => mutate(`/schedules/${booking.id}/move`, { start: new Date(String(f.get('start'))).toISOString(), end: new Date(String(f.get('end'))).toISOString() })}>
      <Field label="New start (your local time)" name="start" type="datetime-local" defaultValue={localInput(booking.start)} />
      <Field label="New end (your local time)" name="end" type="datetime-local" defaultValue={localInput(booking.end)} />
    </Form>
    <Action className="danger-button" action={() => mutate(`/schedules/${booking.id}/cancel`)}>Cancel booking</Action>
  </section>
}
