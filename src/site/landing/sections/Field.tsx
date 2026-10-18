// 06 · Jake's daily log on Wed Oct 21, the passed framing inspection and the
// crew's hours against 06-100. The third photo is an empty rough opening: the
// windows arrive on Wed Oct 28.
import { Copy, Done, Icon, Section, Segs, Tick } from '../parts'
import { Phone } from './ChangeOrder'

/** The rough opening on Oct 21: studs, header and sill plate, no window yet. */
function RoughOpening() {
  return <svg className="log-photo" viewBox="0 0 139 128" role="img" aria-label="Photo: an empty rough opening framed for a window, studs and header, sky through it">
    <rect width="139" height="128" fill="#e7e4c9" />
    <rect x="40" y="26" width="60" height="62" fill="#eef5f8" />
    <path d="M44 74c6-8 12-11 18-7s10 2 15-4 13-5 19 3v22H44z" fill="#d5e4ea" />
    <g fill="#dcd6a8" stroke="#0a5482" strokeWidth=".8"><rect x="2" y="0" width="9" height="128" /><rect x="27" y="0" width="9" height="128" /><rect x="31" y="14" width="77" height="12" /><rect x="36" y="88" width="68" height="7" /><rect x="100" y="0" width="9" height="128" /><rect x="126" y="0" width="9" height="128" /><rect x="58" y="95" width="7" height="33" /><rect x="80" y="95" width="7" height="33" /><rect x="0" y="122" width="139" height="6" /></g>
    <g stroke="#0a5482" strokeWidth=".6" opacity=".55"><path d="M14 0v128M20 0v122M112 0v122M119 0v122M36 20h64M40 92h60" /></g>
    <path d="M50 30l6 50M70 30l4 52M88 30l-4 52" stroke="#9fb9c6" strokeWidth=".5" />
  </svg>
}
const photo = (n: number, alt: string) => <picture key={n}><source type="image/avif" srcSet={`/site/log-photo-${n}-139.avif`} /><img className="log-photo" src={`/site/log-photo-${n}-139.webp`} alt={alt} width={139} height={128} loading="lazy" /></picture>

export function Field() {
  return <Section id="field" tone="sea" className="field">
    <Copy className="centered" eyebrow="In the field · Wed Oct 21" title="The day, logged before the crew leaves.">Jake logs weather, crew, work and photos from his phone. <br className="wide-only" />The inspection and his crew's hours land on the job.</Copy>
    <div className="field-row">
      <div className="card field-card">
        <Icon name="clipboardList" className="big-icon" />
        <h3>Framing inspection</h3>
        <p className="muted"><Segs>{['City of Minneapolis', 'permit BLD-2026-04187']}</Segs></p>
        <p className="ok"><Done />Passed Wed Oct 21, 10:40 am <Tick /></p>
        <p className="next"><i className="dot dot-grey" aria-hidden="true" /><Segs>{['Insulation Thu Oct 22', 'unblocked']}</Segs></p>
      </div>
      <Phone time="4:52" className="log-phone">
        <p className="ph-title">Daily log · Wed Oct 21</p>
        <ul className="log-list">
          <li><Icon name="sun" /><div><b>Weather</b> <small>· National Weather Service</small><span className="ll-val"><Segs>{['41°F', 'clear', 'wind 8 mph']}</Segs></span></div></li>
          <li><Icon name="people" /><div><b>Crew</b><span className="ll-val"><Segs>{['Jake Turner + 1', 'Halvorsen Roofing 3']}</Segs></span></div></li>
          <li><Icon name="note" /><div><b>Work</b><span className="ll-val"><Segs>{['North slope shingled', 'dry-in Thu']}</Segs></span></div></li>
        </ul>
        <div className="log-photos">
          {photo(1, 'Photo: the new rafters and ceiling joists from inside')}
          {photo(2, 'Photo: the north slope shingled')}
          <RoughOpening />
          {photo(3, 'Photo: the framing inspection card posted on a stud')}
        </div>
        <p className="ph-meta"><Segs>{['6 photos', '2 shared with Ana']}</Segs></p>
        <p className="ph-button">Published 4:52 pm</p>
      </Phone>
      <div className="card field-card">
        <Icon name="clock" className="big-icon" />
        <h3><Segs>{['Crew time', 'Mon Oct 19 – Wed Oct 21']}</Segs></h3>
        <p className="muted">Jake Turner + 1</p>
        <p className="hours">32.5 hrs → 06-100 Framing</p>
        <p className="ok"><Done />Approved by Rosa Delgado <Tick /></p>
        <p className="meter-label"><Segs>{['Framing labor', '412 of 440 hrs']}</Segs></p>
        <p className="meter" aria-hidden="true"><i style={{ width: `${(412 / 440) * 100}%` }} /></p>
      </div>
    </div>
  </Section>
}
