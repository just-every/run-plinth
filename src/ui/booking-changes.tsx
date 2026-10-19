import type { Schedule } from '../plinth/model'

/** Booking edits use the same reviewed dependency plan as new tasks. */
export function BookingChanges({ booking, edit }: { booking: Schedule; edit: () => void }) {
  return <section className="side-section"><h3>Change scheduled work</h3>
    <p className="hint">Review dependent shifts, trade conflicts and completion before publishing a change to {booking.description}.</p>
    <button type="button" className="secondary" onClick={edit}>Edit dates or cancel task</button>
  </section>
}
